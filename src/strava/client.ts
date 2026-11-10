// Strava API v3: OAuth 2.0 (eigene Strava-App pro Person), Token-Erneuerung, Abrufe mit Limit-Beachtung (#44).
// Zugang 6 Stunden gültig, Erneuerung über das Erneuerungs-Token (das sich dabei ändern kann).
// Client-Secret und Tokens liegen AES-GCM-verschlüsselt in kv (wie Garmin-Schlüssel und Withings).
import type { Env } from "../env";
import { decrypt, encrypt, kvDelete, kvGet, kvPut } from "../util";

export const API = "https://www.strava.com/api/v3";
export const AUTH_URL = "https://www.strava.com/oauth/authorize";
export const TOKEN_URL = "https://www.strava.com/oauth/token";
/** Nur lesen: eigene Aktivitäten (auch private) und Profil (für Zonen, Ausrüstung) */
export const SCOPE = "read,activity:read_all,profile:read_all";

export interface StravaApp { id: string; secret: string }
interface Tokens { access: string; refresh: string; expires: number; athlete: string | null; name: string | null }

/** Eigene Strava-App: in der App eingetragen (verschlüsselt) oder als Secrets STRAVA_CLIENT_ID/_SECRET */
export async function getApp(env: Env): Promise<StravaApp | null> {
  const stored = await kvGet(env, "stravaApp");
  if (stored) return JSON.parse(await decrypt(env, stored)) as StravaApp;
  if (env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET) return { id: env.STRAVA_CLIENT_ID, secret: env.STRAVA_CLIENT_SECRET };
  return null;
}
export async function saveApp(env: Env, app: StravaApp) {
  await kvPut(env, "stravaApp", await encrypt(env, JSON.stringify(app)));
}

async function tokenRequest(env: Env, app: StravaApp, extra: Record<string, string>): Promise<Tokens> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, ...extra }),
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j?.access_token) {
    const e = new Error(`Strava lehnt die Anmeldung ab (HTTP ${r.status})`);
    (e as any).status = r.status;
    throw e;
  }
  const old = await readTokens(env).catch(() => null);
  const t: Tokens = {
    access: String(j.access_token),
    refresh: String(j.refresh_token),
    expires: (Number(j.expires_at) || Date.now() / 1000 + 21600) * 1000,
    // Das Profil kommt nur beim ersten Tausch mit, bei der Erneuerung nicht
    athlete: j.athlete?.id != null ? String(j.athlete.id) : old?.athlete ?? null,
    name: j.athlete ? [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(" ") || null : old?.name ?? null,
  };
  await kvPut(env, "stravaTokens", await encrypt(env, JSON.stringify(t)));
  return t;
}
async function readTokens(env: Env): Promise<Tokens | null> {
  const stored = await kvGet(env, "stravaTokens");
  return stored ? (JSON.parse(await decrypt(env, stored)) as Tokens) : null;
}

/** Code aus der Rückleitung gegen Tokens tauschen */
export async function exchangeCode(env: Env, code: string) {
  const app = await getApp(env);
  if (!app) throw new Error("Strava-App fehlt");
  await tokenRequest(env, app, { grant_type: "authorization_code", code });
}

export async function connected(env: Env): Promise<boolean> {
  return !!(await kvGet(env, "stravaTokens"));
}
export async function athlete(env: Env): Promise<{ id: string | null; name: string | null }> {
  const t = await readTokens(env).catch(() => null);
  return { id: t?.athlete ?? null, name: t?.name ?? null };
}

/** Gültiger Zugang; erneuert ihn 5 Minuten vor Ablauf. Wirft, wenn nicht verbunden. */
export async function getAccess(env: Env): Promise<string> {
  const t = await readTokens(env);
  const app = await getApp(env);
  if (!t || !app) throw new Error("Strava nicht verbunden");
  if (Date.now() < t.expires - 5 * 60000) return t.access;
  try {
    return (await tokenRequest(env, app, { grant_type: "refresh_token", refresh_token: t.refresh })).access;
  } catch (e) {
    // Erneuerung abgelehnt (z. B. Zugriff in Strava widerrufen): neu verbinden nötig
    if ([400, 401].includes((e as any).status)) await kvDelete(env, "stravaTokens");
    throw e;
  }
}

/** Zugriff bei Strava widerrufen (beim Löschen der Verbindung), Fehler egal */
export async function deauthorize(env: Env) {
  const t = await readTokens(env).catch(() => null);
  if (t) await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: "Bearer " + t.access } }).catch(() => null);
}

/** Strava bittet um eine Pause (Limit pro 15 Minuten oder pro Tag erreicht) */
export class RateLimited extends Error {
  constructor(public daily: boolean) { super(daily ? "Strava-Tageslimit erreicht" : "Strava-Limit für 15 Minuten erreicht"); }
}
/** Zuletzt gemeldete Nutzung: [15 Minuten, Tag] und Grenzen */
export interface Usage { used: [number, number]; limit: [number, number] }
export let lastUsage: Usage | null = null;

function readUsage(h: Headers): Usage | null {
  // Lese-Limit (neu) bevorzugen, sonst Gesamt-Limit
  const u = h.get("X-ReadRateLimit-Usage") || h.get("X-RateLimit-Usage");
  const l = h.get("X-ReadRateLimit-Limit") || h.get("X-RateLimit-Limit");
  if (!u || !l) return null;
  const [u1, u2] = u.split(",").map(Number), [l1, l2] = l.split(",").map(Number);
  return [u1, u2, l1, l2].every((x) => isFinite(x)) ? { used: [u1, u2], limit: [l1, l2] } : null;
}

export async function api(token: string, path: string, params: Record<string, string | number> = {}): Promise<any> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(API + path + (q.size ? "?" + q : ""), { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  lastUsage = readUsage(r.headers) ?? lastUsage;
  if (r.status === 429) throw new RateLimited(!!lastUsage && lastUsage.used[1] >= lastUsage.limit[1]);
  if (r.status === 401) throw new Error("Strava lehnt den Zugang ab (401). Bitte neu verbinden.");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Strava antwortet mit HTTP ${r.status}`);
  return r.json();
}
