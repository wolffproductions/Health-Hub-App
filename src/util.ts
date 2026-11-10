import type { Env } from "./env";

export const enc = new TextEncoder();
export const dec = new TextDecoder();

// ---------- Base64url ----------
export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
}

// ---------- Krypto (Schlüssel aus SESSION_SECRET abgeleitet) ----------
export function hmacKey(env: Env) {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(env.SESSION_SECRET + ":garmin-key"));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encrypt(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text));
  return b64u(iv) + "." + b64u(ct);
}
export async function decrypt(env: Env, stored: string): Promise<string> {
  const [iv, ct] = stored.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, await aesKey(env), fromB64u(ct));
  return dec.decode(pt);
}

// ---------- Schlüssel-Wert-Speicher in D1 ----------
const nowS = () => Math.floor(Date.now() / 1000);

export async function kvGet(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value, expires_at FROM kv WHERE key = ?").bind(key).first<{ value: string; expires_at: number | null }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < nowS()) return null;
  return row.value;
}
export async function kvGetJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const v = await kvGet(env, key);
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
export async function kvPut(env: Env, key: string, value: string, ttlSeconds?: number) {
  await env.DB.prepare("INSERT INTO kv (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, expires_at = ?3")
    .bind(key, value, ttlSeconds ? nowS() + ttlSeconds : null).run();
}
export async function kvDelete(env: Env, key: string) {
  await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(key).run();
}

// ---------- Datum ----------
export function localDate(tz = "Europe/Berlin", offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + offsetDays * 86400000));
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

export const round = (x: unknown, n = 1): number | null => {
  if (x == null || typeof x !== "number" || !isFinite(x)) return null;
  return Math.round(x * 10 ** n) / 10 ** n;
};

// ---------- HTTP ----------
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    // Karten: MapLibre von cdnjs, Vektorkarten, Schriften und Stil von OpenFreeMap (Web-Worker als blob:)
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: blob:; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Cache-Control": "no-store",
};
export function respond(body: BodyInit | null, status = 200, type = "application/json; charset=utf-8", extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "Content-Type": type, ...SECURITY_HEADERS, ...extra } });
}
export const json = (obj: unknown, status = 200) => respond(JSON.stringify(obj), status);
