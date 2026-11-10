// Withings Public API: OAuth 2.0 (eigene Withings-App pro Person), Token-Erneuerung, Abrufe.
// Laut developer.withings.com: Token-Anfragen werden mit Nonce und HMAC-SHA256-Signatur
// (Schlüssel = Client-Secret) signiert. Zugang 3 Stunden gültig, Erneuerungs-Token 1 Jahr; jede
// Erneuerung liefert ein neues Erneuerungs-Token, das alte verfällt danach.
// Client-Secret und Tokens liegen AES-GCM-verschlüsselt in kv (wie der Garmin-Schlüssel).
import type { Env } from "../env";
import { decrypt, encrypt, kvDelete, kvGet, kvPut } from "../util";
import { sign } from "./extract";

export const WBS = "https://wbsapi.withings.net";
export const AUTH_URL = "https://account.withings.com/oauth2_user/authorize2";
export const SCOPE = "user.metrics";

export interface WithingsApp { id: string; secret: string }
interface Tokens { access: string; refresh: string; expires: number; userid: string | null }

/** Eigene Withings-App: in der App eingetragen (verschlüsselt) oder als Secrets WITHINGS_CLIENT_ID/_SECRET */
export async function getApp(env: Env): Promise<WithingsApp | null> {
  const stored = await kvGet(env, "withingsApp");
  if (stored) return JSON.parse(await decrypt(env, stored)) as WithingsApp;
  if (env.WITHINGS_CLIENT_ID && env.WITHINGS_CLIENT_SECRET) return { id: env.WITHINGS_CLIENT_ID, secret: env.WITHINGS_CLIENT_SECRET };
  return null;
}
export async function saveApp(env: Env, app: WithingsApp) {
  await kvPut(env, "withingsApp", await encrypt(env, JSON.stringify(app)));
}

/** POST an Withings (Formular). Withings antwortet immer mit HTTP 200 und {status, body}; status 0 = Erfolg. */
export async function post(path: string, form: Record<string, string>, token?: string): Promise<any> {
  const r = await fetch(WBS + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: new URLSearchParams(form),
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j) throw new Error(`Withings antwortet mit HTTP ${r.status}`);
  if (j.status !== 0) {
    const e = new Error(`Withings-Fehler ${j.status}${j.error ? ": " + String(j.error).slice(0, 80) : ""}`);
    (e as any).wstatus = j.status;
    throw e;
  }
  return j.body;
}

async function nonce(app: WithingsApp): Promise<string> {
  const p = { action: "getnonce", client_id: app.id, timestamp: String(Math.floor(Date.now() / 1000)) };
  const body = await post("/v2/signature", { ...p, signature: await sign(app.secret, p) });
  return String(body.nonce);
}

async function requestToken(env: Env, app: WithingsApp, extra: Record<string, string>): Promise<Tokens> {
  const p = { action: "requesttoken", client_id: app.id, nonce: await nonce(app) };
  const body = await post("/v2/oauth2", { ...p, signature: await sign(app.secret, p), ...extra });
  const t: Tokens = {
    access: String(body.access_token),
    refresh: String(body.refresh_token),
    expires: Date.now() + (Number(body.expires_in) || 10800) * 1000,
    userid: body.userid != null ? String(body.userid) : null,
  };
  await kvPut(env, "withingsTokens", await encrypt(env, JSON.stringify(t)));
  return t;
}

/** Code aus der Rückleitung gegen Tokens tauschen (Code ist nur 30 Sekunden gültig) */
export async function exchangeCode(env: Env, code: string, redirectUri: string) {
  const app = await getApp(env);
  if (!app) throw new Error("Withings-App fehlt");
  await requestToken(env, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export async function connected(env: Env): Promise<boolean> {
  return !!(await kvGet(env, "withingsTokens"));
}

/** Gültiger Zugang; erneuert ihn 5 Minuten vor Ablauf. Wirft, wenn nicht verbunden. */
export async function getAccess(env: Env): Promise<string> {
  const stored = await kvGet(env, "withingsTokens");
  const app = await getApp(env);
  if (!stored || !app) throw new Error("Withings nicht verbunden");
  const t = JSON.parse(await decrypt(env, stored)) as Tokens;
  if (Date.now() < t.expires - 5 * 60000) return t.access;
  try {
    return (await requestToken(env, app, { grant_type: "refresh_token", refresh_token: t.refresh })).access;
  } catch (e) {
    // Erneuerung abgelehnt (z. B. Zugriff in Withings widerrufen): neu verbinden nötig
    if ((e as any).wstatus) await kvDelete(env, "withingsTokens");
    throw e;
  }
}
