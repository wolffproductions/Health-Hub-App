// Google Health API (Fitbit, Pixel Watch, Fitbit Air): OAuth 2.0 mit eigenem Google-Cloud-Projekt pro Person.
// Laut developers.google.com/health/setup: Zugang 1 Stunde; das Erneuerungs-Token bleibt gleich (anders als bei WHOOP).
// Solange das Projekt in Google Cloud auf „Testing“ steht, läuft das Erneuerungs-Token nach 7 Tagen ab
// (`refresh_token_expires_in`); dann muss man neu verbinden. Mit Status „In Produktion“ laufen sie in der Regel nicht ab.
// Wir merken uns das Ablaufdatum, damit die App rechtzeitig Bescheid sagt. Client-Secret und Tokens AES-GCM-verschlüsselt in kv.
import type { Env } from "../env";
import { decrypt, encrypt, kvDelete, kvGet, kvPut } from "../util";

export const API = "https://health.googleapis.com/v4";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Nur lesen: Schlaf, Aktivität/Training, Körper- und Herzwerte */
export const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];

export interface GoogleApp { id: string; secret: string }
interface Tokens { access: string; refresh: string; expires: number; refreshExpires: number | null; scope: string }

export async function getApp(env: Env): Promise<GoogleApp | null> {
  const stored = await kvGet(env, "googleApp");
  if (stored) return JSON.parse(await decrypt(env, stored)) as GoogleApp;
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
  return null;
}
export async function saveApp(env: Env, app: GoogleApp) {
  await kvPut(env, "googleApp", await encrypt(env, JSON.stringify(app)));
}
async function readTokens(env: Env): Promise<Tokens | null> {
  const s = await kvGet(env, "googleTokens");
  return s ? (JSON.parse(await decrypt(env, s)) as Tokens) : null;
}
async function writeTokens(env: Env, t: Tokens) {
  await kvPut(env, "googleTokens", await encrypt(env, JSON.stringify(t)));
}

async function tokenRequest(app: GoogleApp, extra: Record<string, string>): Promise<any> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, ...extra }),
  });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j?.access_token) {
    const e = new Error(j?.error === "invalid_grant" ? "Google-Verbindung abgelaufen, bitte neu verbinden" : `Google lehnt die Anmeldung ab (HTTP ${r.status})`);
    (e as any).status = r.status;
    (e as any).code = j?.error;
    throw e;
  }
  return j;
}

/** Code aus der Rückleitung gegen Tokens tauschen. Ohne Erneuerungs-Token (z. B. „offline“ fehlt) bricht es ab. */
export async function exchangeCode(env: Env, code: string, redirectUri: string) {
  const app = await getApp(env);
  if (!app) throw new Error("Google-App fehlt");
  const j = await tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!j.refresh_token) throw new Error("Google hat kein Erneuerungs-Token geliefert");
  const granted = String(j.scope || "");
  const missing = SCOPES.filter((s) => !granted.includes(s));
  await writeTokens(env, {
    access: String(j.access_token),
    refresh: String(j.refresh_token),
    expires: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    refreshExpires: Number(j.refresh_token_expires_in) > 0 ? Date.now() + Number(j.refresh_token_expires_in) * 1000 : null,
    scope: granted,
  });
  return { missing };
}

export async function connected(env: Env): Promise<boolean> {
  return !!(await kvGet(env, "googleTokens"));
}
/** Für die Anzeige: wann die Verbindung abläuft (nur im Testmodus) und welche Bereiche erlaubt sind */
export async function info(env: Env): Promise<{ refreshExpires: number | null; scopes: string[] }> {
  const t = await readTokens(env).catch(() => null);
  return { refreshExpires: t?.refreshExpires ?? null, scopes: (t?.scope || "").split(" ").filter(Boolean) };
}

/** Gültiger Zugang; erneuert ihn 5 Minuten vor Ablauf. Ist das Erneuerungs-Token abgelaufen: Verbindung löschen. */
export async function getAccess(env: Env): Promise<string> {
  const app = await getApp(env);
  const t = await readTokens(env);
  if (!t || !app) throw new Error("Google Health nicht verbunden");
  if (Date.now() < t.expires - 5 * 60000) return t.access;
  try {
    const j = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: t.refresh });
    const next: Tokens = {
      ...t,
      access: String(j.access_token),
      expires: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      // Google schickt meist kein neues Erneuerungs-Token; wenn doch, übernehmen
      refresh: j.refresh_token ? String(j.refresh_token) : t.refresh,
      refreshExpires: Number(j.refresh_token_expires_in) > 0 ? Date.now() + Number(j.refresh_token_expires_in) * 1000 : t.refreshExpires,
    };
    await writeTokens(env, next);
    return next.access;
  } catch (e) {
    // invalid_grant = abgelaufen (Testmodus, 7 Tage) oder in Google widerrufen: neu verbinden nötig
    if ((e as any).code === "invalid_grant") {
      await kvDelete(env, "googleTokens");
      await kvPut(env, "googleExpired", "1");
    }
    throw e;
  }
}

export async function revoke(env: Env) {
  const t = await readTokens(env).catch(() => null);
  if (t) await fetch(REVOKE_URL + "?token=" + encodeURIComponent(t.refresh), { method: "POST" }).catch(() => null);
}

export class RateLimited extends Error {
  constructor(public wait: number) { super("Google-Limit erreicht, Pause bis " + new Date(Date.now() + wait * 1000).toISOString().slice(11, 16) + " UTC"); }
}

async function check(r: Response) {
  if (r.status === 429) {
    const w = Number(r.headers.get("Retry-After"));
    throw new RateLimited(isFinite(w) && w > 0 ? Math.min(w, 86400) : 120);
  }
  if (r.status === 401) throw new Error("Google lehnt den Zugang ab (401). Bitte neu verbinden.");
  if (r.status === 403) throw new Error("Google verweigert den Zugriff (403). Ist die Google Health API im Projekt aktiviert und sind alle Rechte erlaubt?");
  if (r.status === 404) return null;
  if (!r.ok) {
    const e = new Error(`Google antwortet mit HTTP ${r.status}`);
    (e as any).status = r.status;
    throw e;
  }
  return r.json();
}

/** dataPoints.list für einen Datentyp (z. B. „sleep“), seitenweise über pageToken */
export async function list(token: string, type: string, params: Record<string, string | number>): Promise<any> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`${API}/users/me/dataTypes/${type}/dataPoints?${q}`, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  return check(r);
}

/** dataPoints:dailyRollUp über einen Bereich in Ortszeit (Ende ausschließlich), höchstens 90 Tage */
export async function dailyRollUp(token: string, type: string, from: string, to: string, family?: string): Promise<any> {
  const d = (s: string) => ({ date: { year: +s.slice(0, 4), month: +s.slice(5, 7), day: +s.slice(8, 10) } });
  const body: Record<string, unknown> = { range: { start: d(from), end: d(to) }, windowSizeDays: 1, pageSize: 90 };
  if (family) body.dataSourceFamily = "users/me/dataSourceFamilies/" + family;
  const r = await fetch(`${API}/users/me/dataTypes/${type}/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return check(r);
}
