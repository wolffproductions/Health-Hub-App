import { assembleUi } from "./assemble-ui";
import { UI_PARTS, UI_SHELL } from "./ui/parts";
import appleTouchIcon from "./assets/apple-touch-icon.png";
import icon192 from "./assets/icon-192.png";
import icon512 from "./assets/icon-512.png";
// Schriften (#35), selbst ausgeliefert statt von Google Fonts (dann sieht Google nicht, wer die App öffnet); SIL OFL 1.1
import fontInter from "./assets/fonts/inter.woff2";
import fontMono from "./assets/fonts/jetbrains-mono.woff2";
import type { Env } from "./env";
import { accessValid, authorize, authServerMeta, corsPreflight, listClients, protectedResource, register, removeClient, token, unauthorized } from "./mcp/oauth";
import { handleBody } from "./mcp/server";
import { DEFAULT_MCP_SETTINGS, TOOLS, type McpSettings } from "./mcp/tools";
import { bearerValid, login, loginPage, logout, sessionValid, startSession } from "./auth";
import SETUP from "./setup.html";
import { checkPassword, claimPassword, ensureSecret, hasPassword, passwordFromSecret, passwordProblem, storePassword } from "./setup";
import { passkeyLogin, passkeyLoginOptions, passkeyRoute } from "./passkey";
import { buildData, DEFAULT_ZONES } from "./data";
import { exchangeToken, getApiKey } from "./garmin/client";
import { backfillDays, syncStep, type Meta } from "./garmin/sync";
import { AUTH_URL, connected as withingsConnected, exchangeCode, getApp, saveApp, SCOPE } from "./withings/client";
import { withingsStep, type WithingsMeta } from "./withings/sync";
import * as strava from "./strava/client";
import { stravaEvent, stravaStep, type StravaMeta } from "./strava/sync";
import SW from "./sw.js.txt";
import { addSub, DEFAULT_CFG, removeSub, subs, vapidPublic, type PushCfg, type PushSub } from "./push";
import { morningPush } from "./morgen";
import { VERSION } from "./version";
import { NEWS } from "./neuigkeiten";
import { b64u, encrypt, hmacKey, isDay, json, kvDelete, kvGet, kvGetJson, kvPut, localDate, respond, round, SECURITY_HEADERS } from "./util";

// Oberfläche einmal pro Worker-Start aus src/ui/ zusammensetzen
const DASHBOARD = assembleUi(UI_SHELL, UI_PARTS);

const MANIFEST = {
  id: "/",
  name: "Health Hub",
  short_name: "Health",
  lang: "de",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f2f2ef",
  theme_color: "#f2f2ef",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};
const FONTS: Record<string, ArrayBuffer> = { "/fonts/inter.woff2": fontInter, "/fonts/jetbrains-mono.woff2": fontMono };
const PNGS: Record<string, ArrayBuffer> = {
  "/apple-touch-icon.png": appleTouchIcon,
  "/apple-touch-icon-precomposed.png": appleTouchIcon,
  "/icon-192.png": icon192,
  "/icon-512.png": icon512,
};

async function status(env: Env) {
  const meta = await kvGetJson<Meta>(env, "meta", {});
  const stored = await kvGet(env, "garminKey");
  return {
    key: stored ? "app" : env.GARMIN_API_KEY ? "secret" : "none",
    keyExpires: await kvGet(env, "garminKeyExpires"),
    lastRun: meta.lastRun || null,
    lastRecent: meta.lastRecent || null,
    oldest: meta.oldest || null,
    complete: !!meta.complete,
    lapsPending: meta.lapsPending ?? null,
    lapsPaused: !!(meta.lapsPauseUntil && Date.now() < meta.lapsPauseUntil),
    lastError: meta.lastError || null,
    backfillDays: backfillDays(env),
    files: !!env.FILES,
    passwordSecret: passwordFromSecret(env),
    version: VERSION,
    news: NEWS.slice(0, 6),
    withings: await withingsStatus(env),
    strava: await stravaStatus(env),
  };
}

// ---------- Withings (#3) ----------
// Jede Person legt bei Withings eine eigene App an (Client-ID/-Secret) und verbindet dann ihr Konto.
// Rückleitung nach /withings/callback; der Login-Cookie (SameSite=Lax) kommt dabei mit.
const WITHINGS_KEYS = ["withingsApp", "withingsTokens", "withingsMeta", "withingsState"];
async function withingsStatus(env: Env) {
  const meta = await kvGetJson<WithingsMeta>(env, "withingsMeta", {});
  const app = await getApp(env).catch(() => null);
  return {
    app: !!app,
    connected: await withingsConnected(env),
    lastOk: meta.lastOk || null,
    lastError: meta.lastError || null,
    lastMeas: meta.lastMeas ? new Date(meta.lastMeas * 1000).toISOString() : null,
    loading: !!meta.offset,
  };
}
async function withingsAppRoute(req: Request, env: Env) {
  if (req.method === "DELETE") {
    // Nur die Verbindung, die Messwerte bleiben (Historie wird nie gelöscht)
    for (const k of WITHINGS_KEYS) await kvDelete(env, k);
    return json({ ok: true });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; secret?: unknown };
  const id = String(body.id || "").trim(), secret = String(body.secret || "").trim();
  if (!/^[\w-]{16,200}$/.test(id) || !/^[\w-]{16,200}$/.test(secret)) {
    return json({ ok: false, error: "Client-ID und Client-Secret bitte vollständig aus dem Withings-Entwicklerbereich kopieren." }, 400);
  }
  await saveApp(env, { id, secret });
  await kvDelete(env, "withingsTokens");
  return json({ ok: true });
}
async function withingsConnect(url: URL, env: Env) {
  const app = await getApp(env);
  if (!app) return new Response(null, { status: 303, headers: { Location: "/?withings=app", ...SECURITY_HEADERS } });
  const state = b64u(crypto.getRandomValues(new Uint8Array(18)));
  await kvPut(env, "withingsState", state, 600);
  const q = new URLSearchParams({ response_type: "code", client_id: app.id, scope: SCOPE, redirect_uri: url.origin + "/withings/callback", state });
  return new Response(null, { status: 302, headers: { Location: AUTH_URL + "?" + q, ...SECURITY_HEADERS } });
}
async function withingsCallback(url: URL, env: Env) {
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const saved = await kvGet(env, "withingsState");
  await kvDelete(env, "withingsState");
  let res = "ok";
  if (url.searchParams.get("error")) res = "abgebrochen";
  else if (!code || !state || state !== saved) res = "abgelaufen";
  else {
    try {
      await exchangeCode(env, code, url.origin + "/withings/callback");
      await withingsStep(env);
    } catch (e) {
      console.error("withings", e);
      res = "fehler";
    }
  }
  return new Response(null, { status: 303, headers: { Location: "/?withings=" + res, ...SECURITY_HEADERS } });
}

// ---------- Strava (#44) ----------
// Wie Withings: eigene Strava-App pro Person, Verbindung über /strava/connect → /strava/callback.
// Zusätzlich ein Webhook (/strava/webhook, öffentlich), damit neue Einheiten sofort kommen.
const STRAVA_KEYS = ["stravaApp", "stravaTokens", "stravaMeta", "stravaState", "stravaVerify", "stravaSub"];
async function stravaStatus(env: Env) {
  const meta = await kvGetJson<StravaMeta>(env, "stravaMeta", {});
  const app = await strava.getApp(env).catch(() => null);
  const who = await strava.athlete(env);
  return {
    app: !!app,
    connected: await strava.connected(env),
    name: who.name,
    lastOk: meta.lastOk || null,
    lastError: meta.lastError || null,
    count: meta.count ?? 0,
    complete: !!meta.complete,
    newest: meta.newest ? new Date(meta.newest * 1000).toISOString() : null,
    paused: !!(meta.pauseUntil && Date.now() < meta.pauseUntil),
    usage: meta.usage || null,
    webhook: !!(await kvGet(env, "stravaSub")),
  };
}
async function stravaAppRoute(req: Request, env: Env) {
  if (req.method === "DELETE") {
    // Zugriff bei Strava widerrufen; die geladenen Einheiten bleiben (Historie wird nie gelöscht)
    await stravaWebhookOff(env).catch(() => null);
    await strava.deauthorize(env);
    for (const k of STRAVA_KEYS) await kvDelete(env, k);
    return json({ ok: true });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; secret?: unknown };
  const id = String(body.id || "").trim(), secret = String(body.secret || "").trim();
  if (!/^\d{3,12}$/.test(id) || !/^[0-9a-f]{20,100}$/i.test(secret)) {
    return json({ ok: false, error: "Client-ID (nur Ziffern) und Client-Secret bitte vollständig aus strava.com/settings/api kopieren." }, 400);
  }
  await strava.saveApp(env, { id, secret });
  await kvDelete(env, "stravaTokens");
  return json({ ok: true });
}
async function stravaConnect(url: URL, env: Env) {
  const app = await strava.getApp(env);
  if (!app) return new Response(null, { status: 303, headers: { Location: "/?strava=app", ...SECURITY_HEADERS } });
  const state = b64u(crypto.getRandomValues(new Uint8Array(18)));
  await kvPut(env, "stravaState", state, 600);
  const q = new URLSearchParams({ client_id: app.id, response_type: "code", redirect_uri: url.origin + "/strava/callback", approval_prompt: "auto", scope: strava.SCOPE, state });
  return new Response(null, { status: 302, headers: { Location: strava.AUTH_URL + "?" + q, ...SECURITY_HEADERS } });
}
async function stravaCallback(url: URL, env: Env, ctx: ExecutionContext) {
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const saved = await kvGet(env, "stravaState");
  await kvDelete(env, "stravaState");
  let res = "ok";
  if (url.searchParams.get("error")) res = "abgebrochen";
  else if (!code || !state || state !== saved) res = "abgelaufen";
  // Ohne „Aktivitäten lesen“ (auch private) fehlen Einheiten: Haken bei Strava nicht entfernen
  else if (!(url.searchParams.get("scope") || "").includes("activity:read_all")) res = "rechte";
  else {
    try {
      await strava.exchangeCode(env, code);
      ctx.waitUntil(stravaStep(env));
    } catch (e) {
      console.error("strava", e);
      res = "fehler";
    }
  }
  return new Response(null, { status: 303, headers: { Location: "/?strava=" + res, ...SECURITY_HEADERS } });
}
// Webhook einrichten: Strava ruft dabei sofort GET /strava/webhook zur Bestätigung auf
async function stravaWebhookOn(url: URL, env: Env) {
  const app = await strava.getApp(env);
  if (!app || !(await strava.connected(env))) return json({ ok: false, error: "Erst mit Strava verbinden." }, 400);
  const verify = b64u(crypto.getRandomValues(new Uint8Array(18)));
  await kvPut(env, "stravaVerify", verify);
  const r = await fetch(strava.API + "/push_subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, callback_url: url.origin + "/strava/webhook", verify_token: verify }),
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j?.id) {
    const msg = JSON.stringify(j?.errors || j || "").slice(0, 160);
    return json({ ok: false, error: /already exists/i.test(msg) ? "Für diese Strava-App gibt es schon einen Webhook (z. B. von einer anderen Adresse). Bitte dort entfernen." : "Strava hat den Webhook abgelehnt" + (r.status ? ` (HTTP ${r.status})` : "") + "." }, 400);
  }
  await kvPut(env, "stravaSub", String(j.id));
  return json({ ok: true });
}
async function stravaWebhookOff(env: Env) {
  const app = await strava.getApp(env), id = await kvGet(env, "stravaSub");
  if (app && id) {
    const q = new URLSearchParams({ client_id: app.id, client_secret: app.secret });
    await fetch(strava.API + "/push_subscriptions/" + encodeURIComponent(id) + "?" + q, { method: "DELETE" }).catch(() => null);
  }
  await kvDelete(env, "stravaSub");
}
/** Öffentlicher Webhook-Endpunkt: nur Bestätigung und Hinweis „Einheit neu/geändert/gelöscht“, liefert keine Daten */
async function stravaWebhook(req: Request, url: URL, env: Env, ctx: ExecutionContext) {
  if (req.method === "GET") {
    const verify = await kvGet(env, "stravaVerify");
    if (url.searchParams.get("hub.mode") !== "subscribe" || !verify || url.searchParams.get("hub.verify_token") !== verify) return json({ error: "Nicht erlaubt" }, 403);
    return json({ "hub.challenge": url.searchParams.get("hub.challenge") || "" });
  }
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const ev = (await req.json().catch(() => null)) as any;
  const sub = await kvGet(env, "stravaSub"), who = await strava.athlete(env);
  // Nur Ereignisse des eigenen Webhooks und des eigenen Strava-Kontos
  if (ev && sub && String(ev.subscription_id) === sub && who.id && String(ev.owner_id) === who.id) {
    ctx.waitUntil(stravaEvent(env, ev).catch((e) => console.error("strava webhook", e)));
  }
  return json({ ok: true });
}

// ---------- Morgen-Push (#13) ----------
async function pushRoute(req: Request, url: URL, env: Env, sub: string) {
  const cfg: PushCfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  const save = () => kvPut(env, "pushCfg", JSON.stringify(cfg));
  if (sub === "" && req.method === "GET") {
    return json({ key: await vapidPublic(env), on: cfg.on, time: cfg.time, devices: (await subs(env)).length, lastSent: cfg.lastSent || null, lastResult: cfg.lastResult || null });
  }
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const time = typeof body.time === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(body.time) ? body.time : null;
  if (sub === "subscribe") {
    const s = body.sub as PushSub;
    if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ ok: false, error: "Ungültiges Abo." }, 400);
    await addSub(env, { ...s, ua: String(req.headers.get("User-Agent") || "").slice(0, 120) });
    cfg.on = true; cfg.origin = url.origin; if (time) cfg.time = time;
    await save();
    return json({ ok: true });
  }
  if (sub === "unsubscribe") {
    if (typeof body.endpoint === "string") await removeSub(env, body.endpoint);
    if (!(await subs(env)).length) cfg.on = false;
    await save();
    return json({ ok: true });
  }
  if (sub === "settings") {
    if (time) cfg.time = time;
    if (typeof body.on === "boolean") cfg.on = body.on;
    cfg.origin = url.origin;
    await save();
    return json({ ok: true, time: cfg.time, on: cfg.on });
  }
  if (sub === "test") {
    cfg.origin = url.origin; await save();
    return json({ ok: true, ...(await morningPush(env, true)) });
  }
  return json({ error: "Nicht gefunden" }, 404);
}

// ---------- VO2max (manuell) ----------
const VO2_SPORTS = ["run", "ride"];
async function vo2List(env: Env) {
  const { results } = await env.DB.prepare("SELECT day AS d, sport, value AS v FROM vo2 ORDER BY day").all();
  return results;
}
async function vo2Route(req: Request, env: Env) {
  if (req.method === "GET") return json(await vo2List(env));
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "Nicht erlaubt" }, 405);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = String(body.d || ""), sport = String(body.sport || "");
  if (!isDay(d) || !VO2_SPORTS.includes(sport)) return json({ ok: false, error: "Datum oder Sportart ungültig." }, 400);
  if (req.method === "POST") {
    const v = Number(body.v);
    if (!isFinite(v) || v < 20 || v > 95) return json({ ok: false, error: "Bitte einen Wert zwischen 20 und 95 eintragen." }, 400);
    if (d > localDate(env.TIMEZONE, 1)) return json({ ok: false, error: "Das Datum liegt in der Zukunft." }, 400);
    await env.DB.prepare("INSERT INTO vo2 (day, sport, value) VALUES (?1, ?2, ?3) ON CONFLICT(day, sport) DO UPDATE SET value = ?3")
      .bind(d, sport, round(v, 1)).run();
  } else {
    await env.DB.prepare("DELETE FROM vo2 WHERE day = ? AND sport = ?").bind(d, sport).run();
  }
  return json({ ok: true, list: await vo2List(env) });
}

// ---------- Stimmung (Balance) ----------
// Ein Eintrag pro Tag: 1–5, bis zu 8 Stichworte aus einer festen Liste, Notiz bis 280 Zeichen.
const MOOD_TAGS = ["arbeit", "familie", "freunde", "beziehung", "sport", "draussen", "erholt", "muede", "krank", "alkohol", "koffein", "bildschirm", "sorgen", "stress"];
async function moodList(env: Env) {
  const { results } = await env.DB.prepare("SELECT day, value, tags, note FROM mood ORDER BY day").all<{ day: string; value: number; tags: string | null; note: string | null }>();
  return results.map((r) => ({ d: r.day, v: r.value, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [], note: r.note || "" }));
}
async function moodRoute(req: Request, env: Env) {
  if (req.method === "GET") return json(await moodList(env));
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "Nicht erlaubt" }, 405);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = String(body.d || "");
  if (!isDay(d) || d > localDate(env.TIMEZONE, 1)) return json({ ok: false, error: "Datum ungültig." }, 400);
  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM mood WHERE day = ?").bind(d).run();
    return json({ ok: true, list: await moodList(env) });
  }
  const v = Number(body.v);
  if (!Number.isInteger(v) || v < 1 || v > 5) return json({ ok: false, error: "Bitte 1 bis 5 wählen." }, 400);
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(String))].filter((t) => MOOD_TAGS.includes(t)).slice(0, 8) : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 280) : "";
  await env.DB.prepare(
    "INSERT INTO mood (day, value, tags, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(day) DO UPDATE SET value = ?2, tags = ?3, note = ?4, updated_at = ?5",
  ).bind(d, v, JSON.stringify(tags), note || null, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true, list: await moodList(env) });
}

// ---------- Eigene Pulszonen (Grundlage, Tempo, Schwelle) ----------
async function zonesRoute(req: Request, env: Env) {
  if (req.method === "GET") return json(await kvGetJson(env, "zones", DEFAULT_ZONES));
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const body = (await req.json().catch(() => ({}))) as { zones?: unknown };
  const z = Array.isArray(body.zones) ? body.zones.map((r) => (Array.isArray(r) ? r.map(Number) : [])) : [];
  const ok = z.length === 3 && z.every((r) => r.length === 2 && r.every((v) => Number.isInteger(v) && v >= 60 && v <= 230) && r[0] <= r[1])
    && z[0][1] < z[1][0] && z[1][1] < z[2][0];
  if (!ok) return json({ ok: false, error: "Bitte ganze Pulswerte zwischen 60 und 230 eintragen, aufsteigend und ohne Überschneidung." }, 400);
  await kvPut(env, "zones", JSON.stringify(z));
  return json({ ok: true, zones: z });
}

// Ablaufdatum des Garmin-Schlüssels: Die App fragt beim Eintragen nach der bei Garmin gewählten
// Laufzeit (Garmin liefert das Datum nicht mit). Leer = unbekannt.
async function saveExpiry(env: Env, expires: unknown): Promise<string | null> {
  if (expires === null || expires === undefined || expires === "") {
    await kvDelete(env, "garminKeyExpires");
    return null;
  }
  if (!isDay(expires)) throw new Error("Ablaufdatum ungültig.");
  await kvPut(env, "garminKeyExpires", expires);
  return expires;
}

async function keyExpiryRoute(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as { expires?: unknown };
  try {
    return json({ ok: true, expires: await saveExpiry(env, body.expires) });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
}

async function keyRoute(req: Request, env: Env) {
  if (req.method === "DELETE") {
    await kvDelete(env, "garminKey");
    await kvDelete(env, "garminKeyExpires");
    await kvDelete(env, "token");
    return json({ ok: true });
  }
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; expires?: unknown };
  if (body.expires && !isDay(body.expires)) return json({ ok: false, error: "Ablaufdatum ungültig." }, 400);
  const key = String(body.key || "").trim();
  if (key.length < 20 || key.length > 4000) return json({ ok: false, error: "Das sieht nicht wie ein Garmin-Schlüssel aus." }, 400);
  try {
    await exchangeToken(key);
  } catch {
    return json({ ok: false, error: "Garmin hat den Schlüssel abgelehnt. Ist er abgelaufen oder unvollständig kopiert?" }, 400);
  }
  await kvPut(env, "garminKey", await encrypt(env, key));
  await kvDelete(env, "token");
  await saveExpiry(env, body.expires);
  return json({ ok: true });
}

// ---------- Claude-Zugang (MCP, #5) ----------
async function mcpRoute(req: Request, url: URL, env: Env) {
  if (!(await bearerValid(req, env)) && !(await accessValid(req, env))) return unauthorized(url.origin);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Access-Control-Allow-Origin": "*" } });
  const body = await req.json().catch(() => undefined);
  const out = body === undefined
    ? { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Kein gültiges JSON" } }
    : await handleBody(body, TOOLS, env, "0.2.0");
  if (!out) return new Response(null, { status: 202, headers: { "Access-Control-Allow-Origin": "*" } });
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
}
/** Einstellungen unter Konto → Claude: Adresse, Freigabe der Stimmung, verbundene Apps */
async function mcpSettingsRoute(req: Request, url: URL, env: Env) {
  if (req.method === "DELETE") {
    const id = url.searchParams.get("client") || "";
    if (id) await removeClient(env, id);
    return json({ ok: true });
  }
  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { mood?: unknown };
    const set: McpSettings = { ...DEFAULT_MCP_SETTINGS, mood: body.mood === true };
    await kvPut(env, "mcpSettings", JSON.stringify(set));
  }
  const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
  const clients = (await listClients(env)).map(({ id, name, created, lastUsed }) => ({ id, name, created, lastUsed: lastUsed || null }));
  return json({ url: url.origin + "/mcp", mood: !!set.mood, clients, apiToken: !!env.API_TOKEN });
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Öffentlich, ohne Daten: Healthcheck, Manifest, Icons (iOS lädt Icons teils ohne Cookie)
  if (path === "/health") return json({ ok: true });
  if (path === "/manifest.webmanifest") return respond(JSON.stringify(MANIFEST), 200, "application/manifest+json");
  if (PNGS[path]) return new Response(PNGS[path], { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  if (FONTS[path]) return new Response(FONTS[path], { headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" } });
  // Service Worker für Push (#13): enthält keine Daten, Geltungsbereich die ganze App
  if (path === "/sw.js") return respond(SW, 200, "text/javascript; charset=utf-8", { "Service-Worker-Allowed": "/", "Cache-Control": "no-cache" });
  // Interner Schlüssel: Secret oder in D1 erzeugt (#12). Ohne Tabellen (Migrationen fehlen) geht nichts.
  try { await ensureSecret(env); } catch {
    return respond("Die Datenbank ist noch nicht eingerichtet. Bitte die Migrationen ausführen (passiert bei der Einrichtung und jedem Update automatisch).", 500, "text/plain; charset=utf-8");
  }
  // Strava-Webhook (#44): ruft Strava ohne Login auf, geprüft über Bestätigungs-Token bzw. Abo- und Konto-Nummer
  if (path === "/strava/webhook") return stravaWebhook(req, url, env, ctx);

  // Ersteinrichtung im Browser (#12): noch kein Passwort → erst festlegen
  if (!(await hasPassword(env))) {
    if (path === "/setup" && req.method === "POST") {
      // Keine Herkunftsprüfung: Formulare schicken wegen „no-referrer“ Origin: null, und eine fremde Seite
      // könnte hier nichts, was ein Angreifer nicht auch direkt könnte (das erste Passwort gewinnt)
      const form = await req.formData();
      const pw = String(form.get("password") || ""), repeat = String(form.get("repeat") || "");
      const problem = passwordProblem(pw, repeat);
      if (problem) return respond(SETUP.replace("<!--MSG-->", problem), 400, "text/html; charset=utf-8");
      if (!(await claimPassword(env, pw))) return new Response(null, { status: 303, headers: { Location: "/login", ...SECURITY_HEADERS } });
      return startSession(env);
    }
    if (path.startsWith("/api/") || path === "/mcp" || path.startsWith("/oauth/")) return json({ error: "Noch nicht eingerichtet" }, 401);
    return respond(SETUP.replace("<!--MSG-->", ""), 200, "text/html; charset=utf-8");
  }
  if (path === "/setup") return new Response(null, { status: 303, headers: { Location: "/login", ...SECURITY_HEADERS } });
  // Claude-Zugang (#5): eigene Anmeldung (OAuth bzw. API_TOKEN), deshalb vor dem Login-Cookie
  if (path.startsWith("/.well-known/oauth-protected-resource")) return protectedResource(url.origin);
  if (path === "/.well-known/oauth-authorization-server") return authServerMeta(url.origin);
  if (path.startsWith("/oauth/") || path === "/mcp") {
    if (req.method === "OPTIONS") return corsPreflight();
    if (path === "/oauth/register" && req.method === "POST") return register(req, env);
    if (path === "/oauth/authorize") return authorize(req, url, env);
    if (path === "/oauth/token") return token(req, env);
    if (path === "/mcp") return mcpRoute(req, url, env);
    return json({ error: "Nicht gefunden" }, 404);
  }
  if (path === "/login") return req.method === "POST" ? login(req, env) : loginPage(env);
  if (path === "/logout") return logout();
  // Passkey-Anmeldung (#95): öffentlich, aber nur von der eigenen Login-Seite
  if ((path === "/login/passkey" || path === "/login/passkey/options") && req.method === "POST") {
    if (req.headers.get("Origin") !== url.origin) return json({ error: "Ungültige Herkunft" }, 403);
    return path === "/login/passkey" ? passkeyLogin(req, url, env) : passkeyLoginOptions(env);
  }

  const viaToken = await bearerValid(req, env);
  if (!viaToken && !(await sessionValid(req, env))) {
    if (path.startsWith("/api/")) return json({ error: "Nicht angemeldet" }, 401);
    return new Response(null, { status: 303, headers: { Location: "/login", ...SECURITY_HEADERS } });
  }
  // Schreibende Anfragen aus dem Browser nur von der eigenen Seite
  if (!viaToken && req.method !== "GET" && req.headers.get("Origin") !== url.origin) return json({ error: "Ungültige Herkunft" }, 403);

  if (path === "/") return respond(DASHBOARD, 200, "text/html; charset=utf-8");
  if (path === "/api/mcp") return mcpSettingsRoute(req, url, env);
  if (path === "/api/data") {
    const days = Math.max(28, Math.min(4000, Number(url.searchParams.get("days")) || 800));
    return json(await buildData(env, days));
  }
  if (path === "/api/route") {
    // Route einer Aktivität für die Karte (#16): [[Breite, Länge], …], leer ohne GPS
    const id = url.searchParams.get("id") || "";
    const row = await env.DB.prepare("SELECT route FROM activities WHERE external_id = ? AND route IS NOT NULL LIMIT 1")
      .bind(id).first<{ route: string }>();
    return respond(row?.route || "[]");
  }
  if (path === "/api/streams") {
    // Verläufe einer Einheit (#17): {d, t, v, hr, alt, cad, pw}, null ohne Messpunkte
    const id = url.searchParams.get("id") || "";
    const row = await env.DB.prepare("SELECT streams FROM activities WHERE external_id = ? AND streams IS NOT NULL LIMIT 1")
      .bind(id).first<{ streams: string }>();
    return respond(row?.streams || "null");
  }
  if (path === "/api/password" && req.method === "POST") {
    // App-Passwort ändern (#12); als Secret gesetzt nur per Terminal
    if (passwordFromSecret(env)) return json({ ok: false, error: "Dein Passwort ist als Cloudflare-Secret hinterlegt und lässt sich nur per Terminal ändern." }, 400);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!(await checkPassword(env, String(b.old || ""), await hmacKey(env)))) return json({ ok: false, error: "Das bisherige Passwort stimmt nicht." }, 400);
    const problem = passwordProblem(String(b.new || ""), String(b.repeat || ""));
    if (problem) return json({ ok: false, error: problem }, 400);
    await storePassword(env, String(b.new));
    return json({ ok: true });
  }
  if (path === "/api/status") return json(await status(env));
  if (path === "/api/vo2") return vo2Route(req, env);
  if (path === "/api/mood") return moodRoute(req, env);
  if (path === "/api/zones") return zonesRoute(req, env);
  if (path === "/api/key" && (req.method === "POST" || req.method === "DELETE")) return keyRoute(req, env);
  if (path === "/api/key/expiry" && req.method === "POST") return keyExpiryRoute(req, env);
  if (path === "/api/withings/app" && (req.method === "POST" || req.method === "DELETE")) return withingsAppRoute(req, env);
  if (path === "/api/withings/sync" && req.method === "POST") {
    await withingsStep(env);
    return json(await status(env));
  }
  if (path === "/api/passkeys" || path.startsWith("/api/passkeys/")) return passkeyRoute(req, url, env, path.slice(14).replace(/^\//, ""));
  if (path === "/api/push" || path.startsWith("/api/push/")) return pushRoute(req, url, env, path.slice(10).replace(/^\//, ""));
  if (path === "/api/strava/app" && (req.method === "POST" || req.method === "DELETE")) return stravaAppRoute(req, env);
  if (path === "/api/strava/sync" && req.method === "POST") {
    await stravaStep(env);
    return json(await status(env));
  }
  if (path === "/api/strava/webhook" && req.method === "POST") return stravaWebhookOn(url, env);
  if (path === "/api/strava/webhook" && req.method === "DELETE") { await stravaWebhookOff(env); return json({ ok: true }); }
  if (path === "/strava/connect") return stravaConnect(url, env);
  if (path === "/strava/callback") return stravaCallback(url, env, ctx);
  if (path === "/withings/connect") return withingsConnect(url, env);
  if (path === "/withings/callback") return withingsCallback(url, env);
  if (path === "/api/sync" && req.method === "POST") {
    await syncStep(env, url.searchParams.get("force") === "1");
    return json(await status(env));
  }
  return json({ error: "Nicht gefunden" }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: "Interner Fehler" }, 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await ensureSecret(env).catch(() => null);
    if (!env.SESSION_SECRET) return;
    // Erst Garmin abgleichen, dann (falls fällig) den Morgen-Push mit den frischen Werten senden (#13)
    ctx.waitUntil((async () => {
      if (await getApiKey(env).catch(() => null)) await syncStep(env, true).catch((e) => console.error("sync", e));
      await morningPush(env).catch((e) => console.error("push", e));
    })());
    // Withings (#3) und Strava (#44) unabhängig von Garmin
    if (await withingsConnected(env).catch(() => false)) ctx.waitUntil(withingsStep(env));
    if (await strava.connected(env).catch(() => false)) ctx.waitUntil(stravaStep(env));
  },
} satisfies ExportedHandler<Env>;
