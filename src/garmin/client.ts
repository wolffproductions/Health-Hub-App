// Garmin Connect Personal API
//   Token:  POST .../personal-api-key/token mit "Authorization: ApiKey <key>" -> JWT als Text (24 h, kein Refresh)
//   Daten:  "Authorization: Bearer <jwt>"
// Der Schlüssel wird nie ausgegeben oder geloggt. Er liegt AES-GCM-verschlüsselt in der Datenbank.
import type { Env } from "../env";
import { dec, decrypt, encrypt, fromB64u, kvDelete, kvGet, kvPut } from "../util";

export const BASE = "https://personal.connectapi.garmin.com";

export async function getApiKey(env: Env): Promise<string | null> {
  const stored = await kvGet(env, "garminKey");
  if (stored) return decrypt(env, stored);
  return env.GARMIN_API_KEY || null;
}

export async function exchangeToken(apiKey: string): Promise<string> {
  const r = await fetch(BASE + "/personalapitoken-service/personal-api/personal-api-key/token", {
    method: "POST",
    headers: { Authorization: "ApiKey " + apiKey, Accept: "*/*" },
  });
  if (!r.ok) throw new Error("Schlüssel abgelehnt (HTTP " + r.status + ")");
  return (await r.text()).trim();
}

export async function getToken(env: Env): Promise<string> {
  const cached = await kvGet(env, "token");
  if (cached) {
    try { return await decrypt(env, cached); } catch { await kvDelete(env, "token"); }
  }
  const apiKey = await getApiKey(env);
  if (!apiKey) throw new Error("Kein Garmin-Schlüssel hinterlegt");
  const token = await exchangeToken(apiKey);
  let ttl = 6 * 3600;
  try {
    const exp = JSON.parse(dec.decode(fromB64u(token.split(".")[1]))).exp;
    ttl = Math.max(60, Math.min(ttl, Math.floor(exp - Date.now() / 1000 - 3600)));
  } catch { /* Ablauf unbekannt: Standard-TTL */ }
  await kvPut(env, "token", await encrypt(env, token), ttl);
  return token;
}

/** GET mit JSON-Antwort. 404 = Endpunkt/Daten nicht vorhanden -> null. */
export async function api(token: string, path: string, params?: Record<string, string | number>): Promise<any> {
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Garmin " + path.split("/")[1] + ": HTTP " + r.status);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
