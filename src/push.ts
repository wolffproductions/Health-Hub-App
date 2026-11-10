// Web Push (#13) ohne Fremdbibliothek: VAPID (RFC 8292) und verschlüsselte Nachricht (RFC 8291, aes128gcm),
// alles mit WebCrypto. Funktioniert auf dem iPhone ab iOS 16.4, wenn die App zum Home-Bildschirm hinzugefügt ist.
// Ein Schlüsselpaar pro Instanz (privater Teil verschlüsselt in kv), Abos ebenfalls in kv.
import type { Env } from "./env";
import { b64u, decrypt, encrypt, kvGet, kvGetJson, kvPut } from "./util";
import { encryptPayload, vapidAuth } from "./webpush";
export { encryptPayload };

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string }; added?: string; ua?: string }
export interface PushCfg { on: boolean; time: string; origin?: string; lastSent?: string; lastTry?: string; lastResult?: string }
export const DEFAULT_CFG: PushCfg = { on: false, time: "09:00" };

// ---------- VAPID-Schlüssel ----------
async function vapid(env: Env): Promise<{ pub: string; priv: CryptoKey }> {
  const stored = await kvGet(env, "vapid");
  if (stored) {
    const { pub, jwk } = JSON.parse(await decrypt(env, stored)) as { pub: string; jwk: JsonWebKey };
    return { pub, priv: await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]) };
  }
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = b64u((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  await kvPut(env, "vapid", await encrypt(env, JSON.stringify({ pub, jwk })));
  return { pub, priv: kp.privateKey };
}
export const vapidPublic = async (env: Env) => (await vapid(env)).pub;

async function vapidHeader(env: Env, endpoint: string, subject: string): Promise<string> {
  const { pub, priv } = await vapid(env);
  return vapidAuth(priv, pub, endpoint, subject);
}

// ---------- Abos ----------
export const subs = (env: Env) => kvGetJson<PushSub[]>(env, "pushSubs", []);
export async function addSub(env: Env, s: PushSub) {
  const list = (await subs(env)).filter((x) => x.endpoint !== s.endpoint);
  list.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, added: new Date().toISOString(), ua: s.ua });
  await kvPut(env, "pushSubs", JSON.stringify(list.slice(-5))); // höchstens 5 Geräte
}
export async function removeSub(env: Env, endpoint: string) {
  await kvPut(env, "pushSubs", JSON.stringify((await subs(env)).filter((x) => x.endpoint !== endpoint)));
}

/** An alle Geräte senden. Abgelaufene Abos (404/410) werden entfernt. Liefert die Zahl erfolgreicher Zustellungen. */
export async function sendAll(env: Env, msg: { title: string; body: string; url?: string; tag?: string }, origin: string): Promise<{ ok: number; failed: string[] }> {
  const list = await subs(env);
  let ok = 0; const failed: string[] = [];
  for (const s of list) {
    try {
      const body = await encryptPayload(s, JSON.stringify(msg));
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapidHeader(env, s.endpoint, origin), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "21600", Urgency: "normal", ...(msg.tag ? { Topic: msg.tag } : {}) },
        body,
      });
      if (r.ok) ok++;
      else {
        failed.push(`HTTP ${r.status}`);
        if (r.status === 404 || r.status === 410) await removeSub(env, s.endpoint);
      }
    } catch (e) { failed.push(String((e as Error).message || e).slice(0, 80)); }
  }
  return { ok, failed };
}
