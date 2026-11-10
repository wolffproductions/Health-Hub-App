// Tests für die Passkey-Prüfung (#95) mit synthetischen Schlüsseln: Ein Test-„Authenticator“
// erzeugt ein P-256- bzw. RSA-Schlüsselpaar und baut die Antworten wie ein echtes Gerät.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkChallenge, cborDecode, derToRaw, ES256, FLAG_AT, FLAG_BE, FLAG_BS, FLAG_UP, FLAG_UV, makeChallenge,
  parseAuthData, RS256, toB64u, verifyAssertion, verifyRegistration,
} from "../src/webauthn.ts";

const te = new TextEncoder();
const RP = "health-hub.beispiel.workers.dev";
const ORIGIN = "https://" + RP;
const sha = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const cat = (...a: Uint8Array[]) => { const r = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { r.set(x, p); p += x.length; } return r; };

// ---------- Minimaler CBOR-Schreiber, nur für die Tests ----------
function head(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 65536) return new Uint8Array([(major << 5) | 25, n >> 8, n & 255]);
  return new Uint8Array([(major << 5) | 26, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
function cbor(v: unknown): Uint8Array {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = te.encode(v); return cat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error("nicht unterstützt");
}

// ECDSA r||s → DER, so wie Authenticators signieren
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.slice(i); if (v[0] & 0x80) v = cat(new Uint8Array([0]), v); return cat(new Uint8Array([2, v.length]), v); };
  const body = cat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return cat(new Uint8Array([0x30, body.length]), body);
}

async function authenticator(kind: "es" | "rs" = "es") {
  const kp = kind === "es"
    ? await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
    : await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const b = (s?: string) => Uint8Array.from(Buffer.from(s!, "base64url"));
  const cose = kind === "es"
    ? new Map<number, unknown>([[1, 2], [3, ES256], [-1, 1], [-2, b(jwk.x)], [-3, b(jwk.y)]])
    : new Map<number, unknown>([[1, 3], [3, RS256], [-1, b(jwk.n)], [-2, b(jwk.e)]]);
  const credId = crypto.getRandomValues(new Uint8Array(20));
  return {
    id: toB64u(credId),
    async register(challenge: string, o: { origin?: string; rpId?: string; flags?: number } = {}) {
      const cd = te.encode(JSON.stringify({ type: "webauthn.create", challenge, origin: o.origin ?? ORIGIN, crossOrigin: false }));
      const ad = cat(await sha(te.encode(o.rpId ?? RP)), new Uint8Array([o.flags ?? (FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT)]), new Uint8Array(4),
        new Uint8Array(16), new Uint8Array([0, credId.length]), credId, cbor(cose));
      return { id: toB64u(credId), clientDataJSON: toB64u(cd), attestationObject: toB64u(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]))) };
    },
    async sign(challenge: string, o: { origin?: string; counter?: number; flags?: number; type?: string } = {}) {
      const cd = te.encode(JSON.stringify({ type: o.type ?? "webauthn.get", challenge, origin: o.origin ?? ORIGIN }));
      const n = o.counter ?? 0;
      const ad = cat(await sha(te.encode(RP)), new Uint8Array([o.flags ?? (FLAG_UP | FLAG_UV)]), new Uint8Array([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]));
      const data = cat(ad, await sha(cd));
      const sig = kind === "es"
        ? rawToDer(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, data)))
        : new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, data));
      return { authenticatorData: toB64u(ad), clientDataJSON: toB64u(cd), signature: toB64u(sig) };
    },
  };
}

const hmac = () => crypto.subtle.importKey("raw", te.encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const exp = (challenge: string) => ({ challenge, origin: ORIGIN, rpId: RP });

test("CBOR lesen: Zahlen, Texte, Bytes, Maps", () => {
  const m = cborDecode(cbor(new Map<unknown, unknown>([[1, 2], [-7, "x"], ["b", new Uint8Array([9, 8])], [300, 70000]]))).value as Map<unknown, unknown>;
  assert.equal(m.get(1), 2);
  assert.equal(m.get(-7), "x");
  assert.deepEqual(m.get("b"), new Uint8Array([9, 8]));
  assert.equal(m.get(300), 70000);
  assert.throws(() => cborDecode(new Uint8Array([0x5f])));
});

test("DER-Signatur → r||s, auch mit führenden Nullen", () => {
  const raw = new Uint8Array(64); raw[0] = 0x80; raw[31] = 1; raw[33] = 5; raw[63] = 7;
  assert.deepEqual(derToRaw(rawToDer(raw)), raw);
});

test("Challenge: signiert, zweckgebunden, läuft nach 5 Minuten ab", async () => {
  const k = await hmac();
  const c = await makeChallenge(k, "auth");
  assert.equal(await checkChallenge(k, "auth", c), true);
  assert.equal(await checkChallenge(k, "reg", c), false);
  assert.equal(await checkChallenge(k, "auth", c, Date.now() + 6 * 60000), false);
  const bad = c.slice(0, -2) + (c.endsWith("A") ? "BB" : "AA");
  assert.equal(await checkChallenge(k, "auth", bad), false);
  assert.equal(await checkChallenge(k, "auth", "kaputt!"), false);
  const other = await crypto.subtle.importKey("raw", te.encode("anderes"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  assert.equal(await checkChallenge(other, "auth", c), false);
});

for (const kind of ["es", "rs"] as const) {
  test(`Registrieren und Anmelden (${kind === "es" ? "ES256 / P-256" : "RS256"})`, async () => {
    const dev = await authenticator(kind);
    const cred = await verifyRegistration(await dev.register("reg-1"), exp("reg-1"));
    assert.equal(cred.id, dev.id);
    assert.equal(cred.alg, kind === "es" ? ES256 : RS256);
    assert.equal(cred.synced, true);
    assert.equal(cred.counter, 0);
    const r = await verifyAssertion(await dev.sign("auth-1"), cred, exp("auth-1"));
    assert.equal(r.counter, 0);
  });
}

test("Registrierung: falsche Adresse, fehlendes Face ID, falsche Challenge, fremde ID", async () => {
  const dev = await authenticator();
  await assert.rejects(verifyRegistration(await dev.register("c", { origin: "https://boese.example" }), exp("c")), /Falsche Adresse/);
  await assert.rejects(verifyRegistration(await dev.register("c", { rpId: "boese.example" }), exp("c")), /anderen Adresse/);
  await assert.rejects(verifyRegistration(await dev.register("c", { flags: FLAG_UP | FLAG_AT }), exp("c")), /Face ID/);
  await assert.rejects(verifyRegistration(await dev.register("c"), exp("d")), /Challenge/);
  await assert.rejects(verifyRegistration({ ...(await dev.register("c")), id: "AAAA" }, exp("c")), /Credential-ID/);
});

test("Anmeldung: Signatur, Herkunft, Typ und Schlüssel werden geprüft", async () => {
  const dev = await authenticator(), fremd = await authenticator();
  const cred = await verifyRegistration(await dev.register("r"), exp("r"));
  // Signatur eines anderen Geräts
  await assert.rejects(verifyAssertion(await fremd.sign("a"), cred, exp("a")), /Signatur/);
  // Manipulierte Daten
  const ok = await dev.sign("a");
  const ad = Buffer.from(ok.authenticatorData, "base64url"); ad[32] |= FLAG_BE;
  await assert.rejects(verifyAssertion({ ...ok, authenticatorData: toB64u(ad) }, cred, exp("a")), /Signatur/);
  await assert.rejects(verifyAssertion(await dev.sign("a", { origin: "https://boese.example" }), cred, exp("a")), /Falsche Adresse/);
  await assert.rejects(verifyAssertion(await dev.sign("a", { type: "webauthn.create" }), cred, exp("a")), /Falscher Vorgang/);
  await assert.rejects(verifyAssertion(await dev.sign("a", { flags: FLAG_UP }), cred, exp("a")), /Face ID/);
  await assert.rejects(verifyAssertion(await dev.sign("a"), cred, exp("b")), /Challenge/);
});

test("Zähler: 0 bleibt erlaubt (iCloud), sonst muss er steigen", async () => {
  const dev = await authenticator();
  const cred = await verifyRegistration(await dev.register("r"), exp("r"));
  assert.equal((await verifyAssertion(await dev.sign("a", { counter: 0 }), cred, exp("a"))).counter, 0);
  assert.equal((await verifyAssertion(await dev.sign("a", { counter: 5 }), { ...cred, counter: 4 }, exp("a"))).counter, 5);
  await assert.rejects(verifyAssertion(await dev.sign("a", { counter: 4 }), { ...cred, counter: 4 }, exp("a")), /Zähler/);
  await assert.rejects(verifyAssertion(await dev.sign("a", { counter: 0 }), { ...cred, counter: 4 }, exp("a")), /Zähler/);
});

test("authenticatorData ohne Schlüssel wird gelesen", async () => {
  const ad = cat(new Uint8Array(32), new Uint8Array([FLAG_UP]), new Uint8Array([0, 0, 1, 2]));
  const p = parseAuthData(ad);
  assert.equal(p.counter, 258);
  assert.equal(p.credId, undefined);
  assert.throws(() => parseAuthData(new Uint8Array(10)));
});
