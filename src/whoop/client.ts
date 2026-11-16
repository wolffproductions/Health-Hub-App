// WHOOP API v2: OAuth 2.0 (eigene WHOOP-App pro Person), Token-Erneuerung mit Sperre, Abrufe mit Limit-Beachtung (#119).
// Laut developer.whoop.com: Zugang 1 Stunde gültig, Erneuerung nur mit Scope „offline“. Jede Erneuerung ersetzt Zugang
// UND Erneuerungs-Token, das alte Erneuerungs-Token ist danach ungültig. Zwei gleichzeitige Erneuerungen (Cron und
// „Aktualisieren“) würden die Verbindung zerstören, deshalb erneuert immer nur ein Aufruf, die anderen warten.
// Client-Secret und Tokens liegen AES-GCM-verschlüsselt in kv (wie Garmin-Schlüssel, Withings und Strava).
import type { Env } from "../env";
import { decrypt, encrypt, kvDelete, kvGet, kvPut } from "../util";

export const API = "https://api.prod.whoop.com/developer";
export const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
/** Nur lesen. „offline“ liefert das Erneuerungs-Token. */
export const SCOPE = "offline read:recovery read:cycles read:sleep read:workout read:body_measurement read:profile";

export interface WhoopApp { id: string; secret: string }
interface Tokens { access: string; refresh: string; expires: number; user: string | null; name: string | null }

/** Eigene WHOOP-App: in der App eingetragen (verschlüsselt) oder als Secrets WHOOP_CLIENT_ID/_SECRET */
export async function getApp(env: Env): Promise<WhoopApp | null> {
  const stored = await kvGet(env, "whoopApp");
  if (stored) return JSON.parse(await decrypt(env, stored)) as WhoopApp;
  if (env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET) return { id: env.WHOOP_CLIENT_ID, secret: env.WHOOP_CLIENT_SECRET };
  return null;
}
export async function saveApp(env: Env, app: WhoopApp) {
  await kvPut(env, "whoopApp", await encrypt(env, JSON.stringify(app)));
}

async function readTokens(env: Env): Promise<Tokens | null> {
  const stored = await kvGet(env, "whoopTokens");
  return stored ? (JSON.parse(await decrypt(env, stored)) as Tokens) : null;
}

async function tokenRequest(env: Env, app: WhoopApp, extra: Record<string, string>, keep: Tokens | null): Promise<Tokens> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, ...extra }),
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j?.access_token) {
    const e = new Error(`WHOOP lehnt die Anmeldung ab (HTTP ${r.status})`);
    (e as any).status = r.status;
    throw e;
  }
  const t: Tokens = {
    access: String(j.access_token),
    // Ohne neues Erneuerungs-Token (sollte nicht vorkommen) das alte behalten
    refresh: j.refresh_token ? String(j.refresh_token) : keep?.refresh || "",
    expires: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    user: keep?.user ?? null,
    name: keep?.name ?? null,
  };
  await kvPut(env, "whoopTokens", await encrypt(env, JSON.stringify(t)));
  return t;
}

/** Code aus der Rückleitung gegen Tokens tauschen, danach Name und Nutzer-ID für Anzeige und Webhook merken */
export async function exchangeCode(env: Env, code: string, redirectUri: string) {
  const app = await getApp(env);
  if (!app) throw new Error("WHOOP-App fehlt");
  const t = await tokenRequest(env, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, null);
  if (!t.refresh) throw new Error("WHOOP hat kein Erneuerungs-Token geliefert (Scope „offline“ fehlt)");
  const p = await api(t.access, "/v2/user/profile/basic").catch(() => null);
  if (p) {
    t.user = p.user_id != null ? String(p.user_id) : null;
    t.name = [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
    await kvPut(env, "whoopTokens", await encrypt(env, JSON.stringify(t)));
  }
}

export async function connected(env: Env): Promise<boolean> {
  return !!(await kvGet(env, "whoopTokens"));
}
export async function who(env: Env): Promise<{ user: string | null; name: string | null }> {
  const t = await readTokens(env).catch(() => null);
  return { user: t?.user ?? null, name: t?.name ?? null };
}

// ---------- Sperre für die Erneuerung ----------
const LOCK = "whoopRefreshLock", LOCK_S = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Sperre setzen, wenn frei oder abgelaufen; true = dieser Aufruf darf erneuern. Ein einziger SQL-Befehl, also atomar. */
async function lock(env: Env, id: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO kv (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, expires_at = ?3 WHERE kv.expires_at IS NULL OR kv.expires_at < ?4",
  ).bind(LOCK, id, now + LOCK_S, now).run();
  return (await kvGet(env, LOCK)) === id;
}
async function unlock(env: Env, id: string) {
  await env.DB.prepare("DELETE FROM kv WHERE key = ? AND value = ?").bind(LOCK, id).run();
}

/** Gültiger Zugang; erneuert ihn 5 Minuten vor Ablauf. Wirft, wenn nicht verbunden. */
export async function getAccess(env: Env): Promise<string> {
  const app = await getApp(env);
  let t = await readTokens(env);
  if (!t || !app) throw new Error("WHOOP nicht verbunden");
  const fresh = (x: Tokens) => Date.now() < x.expires - 5 * 60000;
  if (fresh(t)) return t.access;
  const id = crypto.randomUUID();
  if (!(await lock(env, id))) {
    // Ein anderer Aufruf erneuert gerade: bis zu 10 Sekunden auf das neue Token warten
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      t = await readTokens(env);
      if (!t) throw new Error("WHOOP nicht verbunden");
      if (fresh(t)) return t.access;
    }
    throw new Error("WHOOP-Erneuerung läuft noch, bitte gleich noch einmal versuchen");
  }
  try {
    // Erst nach dem Sperren neu lesen: vielleicht hat ein anderer Aufruf schon erneuert
    t = await readTokens(env);
    if (!t) throw new Error("WHOOP nicht verbunden");
    if (fresh(t)) return t.access;
    return (await tokenRequest(env, app, { grant_type: "refresh_token", refresh_token: t.refresh, scope: "offline" }, t)).access;
  } catch (e) {
    // Erneuerung abgelehnt (z. B. Zugriff in WHOOP widerrufen): neu verbinden nötig. Andere Fehler: später erneut.
    if ([400, 401].includes((e as any).status)) await kvDelete(env, "whoopTokens");
    throw e;
  } finally {
    await unlock(env, id);
  }
}

/** Zugriff bei WHOOP widerrufen (beim Löschen der Verbindung), Fehler egal */
export async function revoke(env: Env) {
  const t = await readTokens(env).catch(() => null);
  if (t) await fetch(API + "/v2/user/access", { method: "DELETE", headers: { Authorization: "Bearer " + t.access } }).catch(() => null);
}

/** WHOOP bittet um eine Pause (100 Anfragen pro Minute, 10.000 pro Tag); `wait` in Sekunden */
export class RateLimited extends Error {
  constructor(public wait: number) { super("WHOOP-Limit erreicht, Pause bis " + new Date(Date.now() + wait * 1000).toISOString().slice(11, 16) + " UTC"); }
}

export async function api(token: string, path: string, params: Record<string, string | number> = {}): Promise<any> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(API + path + (q.size ? "?" + q : ""), { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (r.status === 429) {
    const reset = Number(r.headers.get("X-RateLimit-Reset") || r.headers.get("Retry-After"));
    throw new RateLimited(isFinite(reset) && reset > 0 ? Math.min(reset, 86400) : 60);
  }
  if (r.status === 401) throw new Error("WHOOP lehnt den Zugang ab (401). Bitte neu verbinden.");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`WHOOP antwortet mit HTTP ${r.status}`);
  return r.json();
}
