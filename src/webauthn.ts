// Passkeys / WebAuthn (#95) ohne Bibliothek, nur WebCrypto. Reine Funktionen ohne Imports,
// damit die Tests die Datei direkt laden können (node --experimental-strip-types).
//
// Geprüft wird nach WebAuthn Level 2 (§7.1 Registrierung, §7.2 Anmeldung):
// clientDataJSON (Typ, Challenge, Origin), authenticatorData (rpIdHash, Flags, Zähler) und die
// Signatur über authenticatorData || SHA-256(clientDataJSON). Attestation wird nicht ausgewertet
// (wir fordern "none" an): Einen Passkey anlegen kann nur, wer schon angemeldet ist.

export const ES256 = -7;
export const RS256 = -257;

const te = new TextEncoder();
const td = new TextDecoder();

// ---------- Base64url ----------
export function toB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s: string): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("Ungültige Kodierung");
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const concat = (a: Uint8Array, b: Uint8Array) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- CBOR (RFC 8949), nur was attestationObject und COSE-Schlüssel brauchen ----------
type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

/** Liest ein CBOR-Element ab `pos`; liefert Wert und Position dahinter. */
export function cborDecode(buf: Uint8Array, pos = 0, depth = 0): { value: Cbor; end: number } {
  if (depth > 16) throw new Error("CBOR zu tief verschachtelt");
  if (pos >= buf.length) throw new Error("CBOR zu kurz");
  const ib = buf[pos++];
  const major = ib >> 5, ai = ib & 31;
  let len: number;
  if (ai < 24) len = ai;
  else if (ai === 24) len = buf[pos++];
  else if (ai === 25) { len = (buf[pos] << 8) | buf[pos + 1]; pos += 2; }
  else if (ai === 26) { len = ((buf[pos] << 24) >>> 0) + (buf[pos + 1] << 16) + (buf[pos + 2] << 8) + buf[pos + 3]; pos += 4; }
  else throw new Error("CBOR-Länge nicht unterstützt");
  if (pos > buf.length) throw new Error("CBOR zu kurz");
  switch (major) {
    case 0: return { value: len, end: pos };
    case 1: return { value: -1 - len, end: pos };
    case 2:
    case 3: {
      if (pos + len > buf.length) throw new Error("CBOR zu kurz");
      const bytes = buf.slice(pos, pos + len);
      return { value: major === 2 ? bytes : td.decode(bytes), end: pos + len };
    }
    case 4: {
      const arr: Cbor[] = [];
      for (let i = 0; i < len; i++) { const r = cborDecode(buf, pos, depth + 1); arr.push(r.value); pos = r.end; }
      return { value: arr, end: pos };
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < len; i++) {
        const k = cborDecode(buf, pos, depth + 1); const v = cborDecode(buf, k.end, depth + 1);
        map.set(k.value, v.value); pos = v.end;
      }
      return { value: map, end: pos };
    }
    case 7:
      if (ai === 20) return { value: false, end: pos };
      if (ai === 21) return { value: true, end: pos };
      if (ai === 22) return { value: null, end: pos };
  }
  throw new Error("CBOR-Typ nicht unterstützt");
}

// ---------- authenticatorData ----------
export const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_BS = 0x10, FLAG_AT = 0x40;

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  credId?: Uint8Array;
  cose?: Map<Cbor, Cbor>;
}

export function parseAuthData(ad: Uint8Array): AuthData {
  if (ad.length < 37) throw new Error("authenticatorData zu kurz");
  const flags = ad[32];
  const counter = ((ad[33] << 24) >>> 0) + (ad[34] << 16) + (ad[35] << 8) + ad[36];
  const out: AuthData = { rpIdHash: ad.slice(0, 32), flags, counter };
  if (flags & FLAG_AT) {
    let p = 37 + 16; // AAGUID überspringen
    if (ad.length < p + 2) throw new Error("authenticatorData zu kurz");
    const n = (ad[p] << 8) | ad[p + 1]; p += 2;
    if (n < 16 || n > 1023 || ad.length < p + n) throw new Error("Ungültige Credential-ID");
    out.credId = ad.slice(p, p + n);
    const key = cborDecode(ad, p + n);
    if (!(key.value instanceof Map)) throw new Error("Ungültiger öffentlicher Schlüssel");
    out.cose = key.value;
  }
  return out;
}

// ---------- COSE-Schlüssel → JWK ----------
export function coseToJwk(cose: Map<Cbor, Cbor>): { alg: number; jwk: JsonWebKey } {
  const kty = cose.get(1), alg = cose.get(3);
  const bytes = (k: number) => { const v = cose.get(k); if (!(v instanceof Uint8Array)) throw new Error("Schlüsselfeld fehlt"); return v; };
  if (kty === 2 && alg === ES256) {
    if (cose.get(-1) !== 1) throw new Error("Nur P-256 unterstützt");
    const x = bytes(-2), y = bytes(-3);
    if (x.length !== 32 || y.length !== 32) throw new Error("Ungültiger P-256-Schlüssel");
    return { alg: ES256, jwk: { kty: "EC", crv: "P-256", x: toB64u(x), y: toB64u(y), ext: true } };
  }
  if (kty === 3 && alg === RS256) {
    return { alg: RS256, jwk: { kty: "RSA", n: toB64u(bytes(-1)), e: toB64u(bytes(-2)), alg: "RS256", ext: true } };
  }
  throw new Error("Schlüsselart nicht unterstützt");
}

function importKey(alg: number, jwk: JsonWebKey) {
  return alg === ES256
    ? crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    : crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/** ECDSA-Signatur aus DER (so liefern Authenticators sie) in r||s (so will WebCrypto sie). */
export function derToRaw(der: Uint8Array): Uint8Array {
  let p = 0;
  if (der[p++] !== 0x30) throw new Error("Ungültige Signatur");
  if (der[p] & 0x80) p += 1 + (der[p] & 0x7f); else p++;
  const out = new Uint8Array(64);
  for (let i = 0; i < 2; i++) {
    if (der[p++] !== 0x02) throw new Error("Ungültige Signatur");
    let n = der[p++];
    let v = der.slice(p, p + n); p += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32 || n === 0) throw new Error("Ungültige Signatur");
    out.set(v, i * 32 + 32 - v.length);
  }
  return out;
}

// ---------- Challenge ohne Speicher: Ablaufzeit + Zufall, mit HMAC signiert ----------
// So muss die öffentliche Login-Seite nichts in die Datenbank schreiben, bevor jemand angemeldet ist.
const CHALLENGE_MS = 5 * 60000;

export async function makeChallenge(key: CryptoKey, purpose: "reg" | "auth", now = Date.now()): Promise<string> {
  const body = new Uint8Array(24);
  new DataView(body.buffer).setFloat64(0, now + CHALLENGE_MS);
  body.set(crypto.getRandomValues(new Uint8Array(16)), 8);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(te.encode("webauthn:" + purpose + ":"), body)));
  return toB64u(concat(body, sig));
}
export async function checkChallenge(key: CryptoKey, purpose: "reg" | "auth", challenge: string, now = Date.now()): Promise<boolean> {
  let raw: Uint8Array;
  try { raw = fromB64u(challenge); } catch { return false; }
  if (raw.length !== 56) return false;
  const body = raw.slice(0, 24), sig = raw.slice(24);
  const exp = new DataView(body.buffer).getFloat64(0);
  if (!(exp > now) || exp > now + CHALLENGE_MS) return false;
  return crypto.subtle.verify("HMAC", key, sig, concat(te.encode("webauthn:" + purpose + ":"), body));
}

// ---------- Prüfung ----------
interface Expect { challenge: string; origin: string; rpId: string }

function checkClientData(clientDataJSON: Uint8Array, type: string, e: Expect) {
  let cd: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try { cd = JSON.parse(td.decode(clientDataJSON)); } catch { throw new Error("Ungültige Antwort des Geräts"); }
  if (cd.type !== type) throw new Error("Falscher Vorgang");
  if (cd.challenge !== e.challenge) throw new Error("Challenge passt nicht");
  if (cd.origin !== e.origin) throw new Error("Falsche Adresse");
  if (cd.crossOrigin === true) throw new Error("Falsche Adresse");
}
async function checkAuthData(ad: AuthData, e: Expect) {
  if (!equal(ad.rpIdHash, await sha256(te.encode(e.rpId)))) throw new Error("Passkey gehört zu einer anderen Adresse");
  if (!(ad.flags & FLAG_UP)) throw new Error("Keine Bestätigung am Gerät");
  if (!(ad.flags & FLAG_UV)) throw new Error("Face ID / Touch ID nicht bestätigt");
}

export interface Credential { id: string; alg: number; jwk: JsonWebKey; counter: number; synced: boolean }

/** Registrierung (navigator.credentials.create). Liefert den zu speichernden öffentlichen Schlüssel. */
export async function verifyRegistration(r: { id: string; attestationObject: string; clientDataJSON: string }, e: Expect): Promise<Credential> {
  checkClientData(fromB64u(r.clientDataJSON), "webauthn.create", e);
  const att = cborDecode(fromB64u(r.attestationObject)).value;
  if (!(att instanceof Map) || !(att.get("authData") instanceof Uint8Array)) throw new Error("Ungültige Antwort des Geräts");
  const ad = parseAuthData(att.get("authData") as Uint8Array);
  await checkAuthData(ad, e);
  if (!ad.credId || !ad.cose) throw new Error("Kein Schlüssel in der Antwort");
  const id = toB64u(ad.credId);
  if (id !== r.id) throw new Error("Credential-ID passt nicht");
  const { alg, jwk } = coseToJwk(ad.cose);
  await importKey(alg, jwk); // wirft, wenn der Schlüssel unbrauchbar ist
  return { id, alg, jwk, counter: ad.counter, synced: !!(ad.flags & FLAG_BS) };
}

/** Anmeldung (navigator.credentials.get). Liefert den neuen Zählerstand. */
export async function verifyAssertion(
  r: { authenticatorData: string; clientDataJSON: string; signature: string },
  cred: Pick<Credential, "alg" | "jwk" | "counter">,
  e: Expect,
): Promise<{ counter: number }> {
  const cdj = fromB64u(r.clientDataJSON);
  checkClientData(cdj, "webauthn.get", e);
  const adRaw = fromB64u(r.authenticatorData);
  const ad = parseAuthData(adRaw);
  await checkAuthData(ad, e);
  const data = concat(adRaw, await sha256(cdj));
  const sig = fromB64u(r.signature);
  const key = await importKey(cred.alg, cred.jwk);
  const ok = cred.alg === ES256
    ? await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), data)
    : await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!ok) throw new Error("Signatur ungültig");
  // iCloud-Passkeys zählen nicht (immer 0). Zählt ein Gerät, muss der Wert steigen (Hinweis auf Kopie).
  if ((ad.counter || cred.counter) && ad.counter <= cred.counter) throw new Error("Zähler passt nicht");
  return { counter: ad.counter };
}
