// Freunde und Rangliste (#87): Freundeslink, Folge-Anfragen, Follower. Ohne zentralen Server, jede Instanz für sich.
// Ablauf wie ein privates Konto: Der Link https://<adresse>/f/<token> zeigt nur den Namen. Wer ihn in seiner App einträgt,
// schickt eine Anfrage (POST /f/<token>/anfrage mit dem eigenen Link). Erst wenn ich annehme, bekommt seine Instanz einen
// persönlichen Schlüssel (POST an /f/<sein-token>/zugang) und damit Zugriff auf meine Zusammenfassung (GET /f/<token>/daten).
// Follower entfernen = sein Schlüssel ist ungültig, nur für ihn.
// kv: friendsCfg { token, share, origin }, friends (denen ich folge), followers (mit Schlüssel), friendRequests (offene Anfragen).
import type { Env } from "./env";
import { buildData } from "./data";
import { b64u, json, kvGetJson, kvPut, localDate, SECURITY_HEADERS } from "./util";
import { cleanSummary, DEFAULT_SHARE, friendId, parseLink, recentActs, summarize, type FriendSummary, type Share } from "./freunde";
import type { Profile } from "./garmin/sync";
import { DEFAULT_CFG, sendAll, type PushCfg } from "./push";
import { kindOn } from "./mitteilungen";

interface Cfg { token?: string; share?: Share; origin?: string }
/** Einer, dem ich folge: „pending“ = Anfrage gestellt, „ok“ = angenommen (mit Schlüssel) */
interface Friend { id: string; origin: string; token: string; name: string; status?: "pending" | "ok"; key?: string; data?: FriendSummary; last?: string; err?: string }
interface Follower { id: string; origin: string; token: string; name: string; at: string; key: string }
interface FollowRequest { id: string; origin: string; token: string; name: string; at: string }

const MAX_FRIENDS = 50, MAX_FOLLOWERS = 100, MAX_REQUESTS = 30;
const newToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
const fid = (origin: string, token: string) => friendId({ origin, token });
/** Passt die Kennung? Immer aus Adresse und Token, nie aus dem gespeicherten Feld */
const is = (id: unknown) => (x: { origin: string; token: string }) => fid(x.origin, x.token) === id;
const cfgOf = async (env: Env) => { const c = await kvGetJson<Cfg>(env, "friendsCfg", {}); return { ...c, share: { ...DEFAULT_SHARE, ...(c.share || {}) } }; };
const myLink = (c: Cfg) => (c.origin && c.token ? `${c.origin}/f/${c.token}` : null);
const save = (env: Env, k: string, v: unknown) => kvPut(env, k, JSON.stringify(v));

/** Fremde Instanz abfragen: kurze Wartezeit, kleine Antwort, keine Weiterleitungen (Workers kennen nur „follow“ und „manual“) */
async function getJson(url: string, key?: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) }, signal: AbortSignal.timeout(8000), redirect: "manual" });
  if ((res.status >= 300 && res.status < 400) || res.status === 0) throw new Error("Link leitet weiter, nicht erlaubt");
  if (res.status === 401 || res.status === 403) throw new Error("Zugang entzogen");
  if (!res.ok) throw new Error(res.status === 404 ? "Link ungültig oder zurückgezogen" : "Nicht erreichbar (" + res.status + ")");
  const text = await res.text();
  if (text.length > 400000) throw new Error("Antwort zu groß");
  return JSON.parse(text);
}
const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000), redirect: "manual" });
/** Öffentlicher Teil eines Links: nur Name (und ob es eine Health-Hub-Instanz ist) */
async function fetchName(origin: string, token: string): Promise<string> {
  const j = (await getJson(`${origin}/f/${token}`)) as { v?: number; name?: unknown };
  if (!j || j.v !== 1 || typeof j.name !== "string") throw new Error("Keine Health-Hub-Instanz");
  return j.name.slice(0, 40);
}
async function fetchData(f: Friend): Promise<FriendSummary> {
  const s = cleanSummary(await getJson(`${f.origin}/f/${f.token}/daten`, f.key));
  if (!s) throw new Error("Keine Health-Hub-Instanz");
  return s;
}

/** Eigene Zusammenfassung nach Freigaben (15 Min. zwischengespeichert, damit Freunde die Instanz nicht belasten) */
/** Eigene Zusammenfassung plus Anzahl Follower und Gefolgt (immer aktuell) */
async function ownSummary(env: Env, share: Share, fresh = false): Promise<FriendSummary> {
  const [s, followers, friends] = await Promise.all([ownSummaryCached(env, share, fresh), kvGetJson<Follower[]>(env, "followers", []), kvGetJson<Friend[]>(env, "friends", [])]);
  return { ...s, fol: followers.length, fing: friends.filter((f) => f.status === "ok").length };
}
async function ownSummaryCached(env: Env, share: Share, fresh = false): Promise<FriendSummary> {
  const key = "friendsOut:" + JSON.stringify(share);
  if (!fresh) { const c = await kvGetJson<{ t: number; s: FriendSummary } | null>(env, "friendsOut", null); if (c && c.s && (c as any).k === key && Date.now() - c.t < 15 * 60000) return c.s; }
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const data = await buildData(env, 800, { exclude: ["strava", "whoop", "google"] });
  const acts = Object.values(data.acts as Record<string, any>);
  const runs = acts.filter((a) => /running/.test(a.type || "") && a.vo2).sort((a, b) => (a.date < b.date ? -1 : 1));
  const me = await kvGetJson<{ name?: string; img?: string }>(env, "me", {});
  // Gewichte aus den Tageswerten (Withings vor Garmin, wie überall), nur für W/kg; das Gewicht selbst wird nicht geteilt
  const weights = Object.values(data.daily as Record<string, any>).filter((x) => x.kg != null).map((x) => ({ d: x.d as string, kg: x.kg as number })).sort((a, b) => (a.d < b.d ? -1 : 1));
  // Routen nur für die geteilten letzten Aktivitäten (gekürzt in summarize)
  const routes: Record<string, unknown> = {};
  if (share.akt) {
    const own = acts.filter((a) => a.src !== "strava" && a.src !== "whoop" && a.src !== "google" && !a.hidden);
    const ids = recentActs(own, today).filter((a) => a.rt).map((a) => String(a.id));
    if (ids.length) {
      const rows = await env.DB.prepare(`SELECT external_id, route FROM activities WHERE source = 'garmin' AND external_id IN (${ids.map(() => "?").join(",")}) AND route IS NOT NULL`).bind(...ids).all<{ external_id: string; route: string }>();
      for (const r of rows.results) { try { routes[r.external_id] = JSON.parse(r.route); } catch { /* kaputte Route weglassen */ } }
    }
  }
  const s = summarize(acts, share, me, today, runs.length ? runs[runs.length - 1].vo2 : null, weights, routes);
  await kvPut(env, "friendsOut", JSON.stringify({ t: Date.now(), k: key, s }));
  return s;
}
const myName = async (env: Env) => ((await kvGetJson<{ name?: string }>(env, "me", {})).name || "").trim() || "Ohne Namen";

/** Mitteilung aufs Handy, wenn Push an ist und Freunde-Mitteilungen erlaubt sind (#161; darf scheitern) */
async function notify(env: Env, title: string, body: string) {
  const cfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  if (!kindOn(cfg, "freunde")) return;
  await sendAll(env, { title, body, url: "/", tag: "freunde" }, cfg.origin || "mailto:health-hub@localhost").catch(() => null);
}

// ---------- öffentlich: /f/<token>, /anfrage, /zugang, /daten ----------
export async function publicFriendRoute(req: Request, env: Env, path: string, ctx: ExecutionContext): Promise<Response> {
  const m = /^\/f\/([A-Za-z0-9_-]{32,64})(?:\/(anfrage|zugang|daten))?\/?$/.exec(path);
  const c = await cfgOf(env);
  if (!m || !c.token || m[1] !== c.token) return json({ error: "Nicht gefunden" }, 404);
  const part = m[2];
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  if (part === "anfrage") {
    // Jemand möchte mir folgen: seinen Link prüfen (gibt es die Instanz wirklich?) und als offene Anfrage merken
    if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
    const l = parseLink(String(body.link || ""));
    if (!l || l.origin === c.origin) return json({ ok: false }, 400);
    let name: string;
    try { name = await fetchName(l.origin, l.token); } catch { return json({ ok: false }, 400); }
    const followers = await kvGetJson<Follower[]>(env, "followers", []);
    const known = followers.find((f) => f.origin === l.origin);
    // Folgt schon (z. B. erneute Anfrage nach Neuinstallation): Zugang einfach noch einmal schicken
    if (known) { ctx.waitUntil(postJson(`${l.origin}/f/${l.token}/zugang`, { link: myLink(c), key: known.key }).catch(() => null)); return json({ ok: true, status: "ok" }); }
    const reqs = (await kvGetJson<FollowRequest[]>(env, "friendRequests", [])).filter((r) => r.origin !== l.origin);
    // Gegenseitig (#87): Folge ich dieser Instanz schon (oder habe dort angefragt), gilt das als Zustimmung, also sofort annehmen.
    // Sicher, weil der Schlüssel nur an die angegebene Adresse geht, nie an den, der die Anfrage geschickt hat.
    const mutual = (await kvGetJson<Friend[]>(env, "friends", [])).some((f) => f.origin === l.origin);
    if (mutual && followers.length < MAX_FOLLOWERS) {
      const key = newToken();
      followers.push({ id: fid(l.origin, l.token), origin: l.origin, token: l.token, name, at: new Date().toISOString(), key });
      await save(env, "followers", followers);
      await save(env, "friendRequests", reqs);
      ctx.waitUntil(postJson(`${l.origin}/f/${l.token}/zugang`, { link: myLink(c), key }).catch(() => null));
      ctx.waitUntil(notify(env, "Neuer Follower", name + " folgt dir jetzt in Health Hub."));
      return json({ ok: true, status: "ok" });
    }
    reqs.push({ id: fid(l.origin, l.token), origin: l.origin, token: l.token, name, at: new Date().toISOString() });
    await save(env, "friendRequests", reqs.slice(-MAX_REQUESTS));
    ctx.waitUntil(notify(env, "Neue Anfrage", name + " möchte dir in Health Hub folgen."));
    return json({ ok: true, status: "pending" });
  }

  if (part === "zugang") {
    // Meine Anfrage wurde angenommen: Schlüssel nur übernehmen, wenn ich dort angefragt habe und er wirklich funktioniert
    if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
    const l = parseLink(String(body.link || "")), key = typeof body.key === "string" ? body.key : "";
    if (!l || !/^[A-Za-z0-9_-]{32,64}$/.test(key)) return json({ ok: false }, 400);
    const friends = await kvGetJson<Friend[]>(env, "friends", []);
    const f = friends.find((x) => x.origin === l.origin);
    if (!f) return json({ ok: false }, 404);
    try { const d = await fetchData({ ...f, token: l.token, key }); f.token = l.token; f.key = key; f.status = "ok"; f.data = d; f.name = d.name; f.err = undefined; f.last = new Date().toISOString(); }
    catch { return json({ ok: false }, 400); }
    await save(env, "friends", friends);
    ctx.waitUntil(notify(env, "Anfrage angenommen", f.name + " hat deine Anfrage angenommen."));
    return json({ ok: true });
  }

  if (part === "daten") {
    // Zusammenfassung nur für angenommene Follower mit ihrem persönlichen Schlüssel
    const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const followers = await kvGetJson<Follower[]>(env, "followers", []);
    if (!key || !followers.some((f) => f.key === key)) return json({ error: "Kein Zugang" }, 403);
    return json(await ownSummary(env, c.share!));
  }

  if (req.method !== "GET") return json({ error: "Nicht erlaubt" }, 405);
  const name = await myName(env);
  // Öffentlich nur der Name (für die Anfrage). Keine Werte, keine Bilder.
  if ((req.headers.get("Accept") || "").includes("application/json")) return json({ v: 1, name });
  // Im Browser (z. B. QR-Code gescannt): kurze Erklärung
  const n = name.replace(/[<>&"]/g, "");
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Health Hub · ${n}</title>
<style>body{margin:0;font:17px/1.45 -apple-system,system-ui,sans-serif;background:#0a0a0a;color:#f5f5f5;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}main{max-width:420px;display:flex;flex-direction:column;gap:16px}h1{margin:0;font-size:28px;letter-spacing:-.02em}p{margin:0;color:#a7a7a7}code{display:block;word-break:break-all;background:#141414;border:1px solid #262626;border-radius:8px;padding:12px;font-size:13px;color:#f5f5f5}button{font:inherit;font-weight:600;padding:12px 16px;border:0;border-radius:8px;background:#f5f5f5;color:#0a0a0a}</style></head>
<body><main><h1>${n} lädt dich ein</h1><p>Kopiere diesen Link und füge ihn in deiner Health-Hub-App unter Statistiken → Freunde → „Freunde und Freigaben“ ein. ${n} bekommt dann eine Anfrage und kann sie annehmen.</p><code id="l"></code><button id="b">Link kopieren</button><p>Du brauchst dafür deine eigene Health-Hub-App.</p></main>
<script>const l=location.origin+location.pathname;document.getElementById('l').textContent=l;document.getElementById('b').onclick=()=>navigator.clipboard.writeText(l).then(()=>{document.getElementById('b').textContent='Kopiert'});</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS } });
}

// ---------- angemeldet: /api/freunde ----------
async function refreshOne(f: Friend) {
  if (f.status !== "ok" || !f.key) return;
  try { f.data = await fetchData(f); f.name = f.data.name; f.err = undefined; } catch (e) { f.err = (e as Error).message; }
  f.last = new Date().toISOString();
}
/** Namen nachschlagen, die beim Anfragen noch fehlten („Ohne Namen“): höchstens 5 pro Lauf, Fehler egal */
async function refreshNames(env: Env, k: "followers" | "friendRequests") {
  const list = await kvGetJson<Array<{ origin: string; token: string; name: string }>>(env, k, []);
  const todo = list.filter((x) => !x.name || x.name === "Ohne Namen").slice(0, 5);
  if (!todo.length) return;
  let changed = false;
  await Promise.all(todo.map(async (x) => { try { const n = await fetchName(x.origin, x.token); if (n && n !== x.name) { x.name = n; changed = true; } } catch { /* später erneut */ } }));
  if (changed) await save(env, k, list);
}
/** Im Cron: Zusammenfassungen der angenommenen Freunde holen (höchstens alle 25 Minuten, höchstens 20 pro Lauf) */
export async function refreshFriends(env: Env, force = false) {
  await refreshNames(env, "followers");
  await refreshNames(env, "friendRequests");
  const list = await kvGetJson<Friend[]>(env, "friends", []);
  const due = list.filter((f) => f.status === "ok" && (force || !f.last || Date.now() - Date.parse(f.last) > 25 * 60000)).slice(0, 20);
  if (!due.length) return;
  await Promise.all(due.map(refreshOne));
  await save(env, "friends", list);
}

/** Anfrage an einen Link stellen; merkt den Freund als „angefragt“ */
async function requestFollow(env: Env, c: Cfg, origin: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const friends = await kvGetJson<Friend[]>(env, "friends", []);
  if (friends.length >= MAX_FRIENDS && !friends.some((x) => x.origin === origin)) return { ok: false, error: "Höchstens " + MAX_FRIENDS + " Freunde." };
  let name: string;
  try { name = await fetchName(origin, token); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const f: Friend = { id: fid(origin, token), origin, token, name, status: "pending" };
  await save(env, "friends", [...friends.filter((x) => x.origin !== origin), f]);
  const res = await postJson(`${origin}/f/${token}/anfrage`, { link: myLink(c) }).catch(() => null);
  if (!res || !res.ok) return { ok: false, error: "Anfrage konnte nicht zugestellt werden." };
  return { ok: true };
}

export async function friendsRoute(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const c = await cfgOf(env);
  // Eigene Adresse merken (für den Link) und beim ersten Mal ein Token anlegen
  if (c.origin !== url.origin || !c.token) { c.origin = url.origin; c.token ||= newToken(); await save(env, "friendsCfg", c); }
  const state = async (fresh = false, extra: Record<string, unknown> = {}) => {
    const friends = await kvGetJson<Friend[]>(env, "friends", []);
    const followers = await kvGetJson<Follower[]>(env, "followers", []);
    const reqs = await kvGetJson<FollowRequest[]>(env, "friendRequests", []);
    return json({
      ...extra, link: myLink(c), share: c.share,
      me: await ownSummary(env, { umfang: true, best: true, watt: true, vo2: true, bild: true, akt: false }, fresh),
      friends: friends.map((f) => ({ id: fid(f.origin, f.token), name: f.name, status: f.status === "ok" ? "ok" : "pending", data: f.data || null, last: f.last || null, err: f.err || null })),
      // Profilbild und Profil eines Followers nur, wenn ich ihm auch folge (dann kenne ich seine Zusammenfassung)
      followers: followers.map((f) => { const fr = friends.find((x) => x.origin === f.origin); return { id: fid(f.origin, f.token), name: fr?.name || f.name, at: f.at, following: !!fr, img: fr?.data?.img || undefined, friendId: fr && fr.status === "ok" && fr.data ? fid(fr.origin, fr.token) : undefined }; }),
      requests: reqs.map((r) => ({ id: fid(r.origin, r.token), name: r.name, at: r.at })),
    });
  };
  if (req.method === "GET") { if (url.searchParams.get("refresh")) await refreshFriends(env, true); return state(); }
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  if (b.action === "share" && b.share && typeof b.share === "object") {
    for (const k of Object.keys(DEFAULT_SHARE) as Array<keyof Share>) if (typeof b.share[k] === "boolean") c.share![k] = b.share[k];
    await save(env, "friendsCfg", c);
    return state(true);
  }
  // Neuer Link: alter tot, alle Follower und offenen Anfragen weg (Schlüssel ungültig)
  if (b.action === "newLink") { c.token = newToken(); await save(env, "friendsCfg", c); await save(env, "followers", []); await save(env, "friendRequests", []); return state(); }
  if (b.action === "add" || b.action === "followBack") {
    let l = b.action === "add" ? parseLink(String(b.link || "")) : null;
    if (b.action === "followBack") { const f = (await kvGetJson<Follower[]>(env, "followers", [])).find(is(b.id)); if (f) l = { origin: f.origin, token: f.token }; }
    if (!l) return json({ ok: false, error: "Das ist kein gültiger Freundeslink." }, 400);
    if (l.origin === url.origin) return json({ ok: false, error: "Das ist dein eigener Link." }, 400);
    const r = await requestFollow(env, c, l.origin, l.token);
    if (!r.ok) return json({ ok: false, error: r.error }, 400);
    return state(false, { ok: true });
  }
  if (b.action === "accept" || b.action === "decline") {
    const reqs = await kvGetJson<FollowRequest[]>(env, "friendRequests", []);
    const r = reqs.find(is(b.id));
    await save(env, "friendRequests", reqs.filter((x) => !is(b.id)(x)));
    if (r && b.action === "accept") {
      // Persönlicher Schlüssel für diesen Follower; seine Instanz bekommt ihn zugeschickt
      const key = newToken();
      const followers = (await kvGetJson<Follower[]>(env, "followers", [])).filter((f) => f.origin !== r.origin);
      followers.push({ id: fid(r.origin, r.token), origin: r.origin, token: r.token, name: r.name, at: new Date().toISOString(), key });
      await save(env, "followers", followers.slice(-MAX_FOLLOWERS));
      ctx.waitUntil(postJson(`${r.origin}/f/${r.token}/zugang`, { link: myLink(c), key }).catch(() => null));
    }
    return state();
  }
  if (b.action === "remove") { await save(env, "friends", (await kvGetJson<Friend[]>(env, "friends", [])).filter((x) => !is(b.id)(x))); return state(); }
  // Follower entfernen: sein Schlüssel verfällt sofort, nur für ihn
  if (b.action === "removeFollower") { await save(env, "followers", (await kvGetJson<Follower[]>(env, "followers", [])).filter((x) => !is(b.id)(x))); return state(); }
  return json({ error: "Unbekannte Aktion" }, 400);
}
