// Web-Push-Verschlüsselung (RFC 8291, aes128gcm) mit WebCrypto. Ohne Importe, damit die Tests sie direkt laden.
export interface PushKeys { keys: { p256dh: string; auth: string } }
const enc = new TextEncoder();
const fromB64u = (s: string) => { const b = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0)); };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

/** Nachricht für ein Abo verschlüsseln. `salt` und `serverKeys` nur für Tests vorgeben. */
export async function encryptPayload(sub: PushKeys, payload: string, salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys?: CryptoKeyPair): Promise<Uint8Array> {
  const uaPub = fromB64u(sub.keys.p256dh), auth = fromB64u(sub.keys.auth);
  const as = serverKeys || ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPub = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Eine einzige Nachricht: Inhalt + Trennbyte 0x02
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(16 + 4 + 1);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, ct);
}


const b64u = (buf: ArrayBuffer | Uint8Array) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

/** VAPID-Kopfzeile (RFC 8292): JWT mit ES256, Empfänger = Herkunft des Push-Dienstes, 12 h gültig */
export async function vapidAuth(priv: CryptoKey, pub: string, endpoint: string, subject: string, now = Date.now()): Promise<string> {
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  // WebCrypto liefert die Signatur bereits im JWT-Format (r‖s, je 32 Byte)
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, enc.encode(h + "." + c));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${pub}`;
}
