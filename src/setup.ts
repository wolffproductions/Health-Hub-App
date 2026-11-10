// Einrichtung ohne Terminal (#12): Fehlen die Secrets SESSION_SECRET bzw. APP_PASSWORD (z. B. nach dem
// „Deploy to Cloudflare“-Button), erzeugt der Worker den internen Schlüssel selbst und speichert ihn in D1;
// das App-Passwort legt man beim allerersten Aufruf im Browser fest (gespeichert als PBKDF2-Hash).
// Sind die Secrets gesetzt (Einrichtungsskript), bleibt alles wie bisher.
import type { Env } from "./env";
import { b64u, enc, fromB64u, kvGet } from "./util";

const ITER = 100_000; // Höchstwert für PBKDF2 in Cloudflare Workers

/** Internen Schlüssel sicherstellen: Secret, sonst aus D1, sonst neu erzeugen (sicher bei gleichzeitigen Aufrufen) */
export async function ensureSecret(env: Env): Promise<void> {
  if (env.SESSION_SECRET) return;
  let v = await kvGet(env, "sessionSecret");
  if (!v) {
    await env.DB.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('sessionSecret', ?)").bind(b64u(crypto.getRandomValues(new Uint8Array(32)))).run();
    v = await kvGet(env, "sessionSecret");
  }
  env.SESSION_SECRET = v || undefined;
}

export async function hasPassword(env: Env): Promise<boolean> {
  return !!env.APP_PASSWORD || !!(await kvGet(env, "appPassword"));
}
/** Passwort als Secret gesetzt? Dann lässt es sich nur per Terminal ändern. */
export const passwordFromSecret = (env: Env) => !!env.APP_PASSWORD;

async function pbkdf2(pw: string, salt: Uint8Array, iter = ITER): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

export async function storePassword(env: Env, pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const value = JSON.stringify({ v: 1, iter: ITER, salt: b64u(salt), hash: b64u(await pbkdf2(pw, salt)) });
  await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('appPassword', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(value).run();
}

/** Erstes Passwort festlegen; scheitert, wenn schon eins existiert (nur der erste Aufruf darf das) */
export async function claimPassword(env: Env, pw: string): Promise<boolean> {
  if (await hasPassword(env)) return false;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const value = JSON.stringify({ v: 1, iter: ITER, salt: b64u(salt), hash: b64u(await pbkdf2(pw, salt)) });
  const r = await env.DB.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('appPassword', ?)").bind(value).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Zeitkonstanter Vergleich über HMAC mit zufälligem Schlüssel */
async function same(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const k = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return crypto.subtle.verify("HMAC", k, await crypto.subtle.sign("HMAC", k, a), b);
}

export async function checkPassword(env: Env, given: string, hmac: CryptoKey): Promise<boolean> {
  if (env.APP_PASSWORD) {
    const expected = await crypto.subtle.sign("HMAC", hmac, enc.encode("pw:" + env.APP_PASSWORD));
    return crypto.subtle.verify("HMAC", hmac, expected, enc.encode("pw:" + given));
  }
  const stored = await kvGet(env, "appPassword");
  if (!stored) return false;
  const { iter, salt, hash } = JSON.parse(stored) as { iter: number; salt: string; hash: string };
  return same(await pbkdf2(given, fromB64u(salt), iter), fromB64u(hash));
}

/** Regeln für ein neues Passwort; liefert die Fehlermeldung oder null */
export function passwordProblem(pw: string, repeat?: string): string | null {
  if (pw.length < 10) return "Bitte mindestens 10 Zeichen verwenden.";
  if (pw.length > 200) return "Höchstens 200 Zeichen.";
  if (repeat !== undefined && pw !== repeat) return "Die beiden Eingaben stimmen nicht überein.";
  return null;
}
