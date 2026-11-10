// Tests für Erholungs-Ampel, Morgen-Push-Zeitplan und Web-Push-Verschlüsselung (synthetische Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, loadRatio, pushText } from "../src/ampel.ts";
import { decide } from "../src/ampel.ts";
import { encryptPayload, vapidAuth } from "../src/webpush.ts";
import { b64u } from "../src/util.ts";

const day = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);

test("Ampel: grün, gelb, rot nach den offengelegten Regeln", () => {
  const days = Array.from({ length: 31 }, (_, i) => ({ d: day(i), rhr: 48, hrv: 62, hrvLo: 52, hrvHi: 70, score: 85, slp: 7.5 }));
  const loads = new Map(days.map((x) => [x.d, 50]));
  let a = assess(days, loads)!;
  assert.equal(a.day, day(30));
  assert.equal(a.light, "g");
  assert.equal(a.verdict, "Bereit für intensives Training");
  // HRV unter Normalbereich → rot
  a = assess([...days.slice(0, 30), { ...days[30], hrv: 45 }], loads)!;
  assert.equal(a.light, "r");
  // Ruhepuls +3 und Schlafscore 70 → zwei gelbe → moderat
  a = assess([...days.slice(0, 30), { ...days[30], rhr: 51, score: 70 }], loads)!;
  assert.equal(a.verdict, "Moderat trainieren");
  assert.equal(assess([], loads), null);
});

test("Last akut zu chronisch und Meldungstext", () => {
  const loads = new Map<string, number>();
  for (let i = 0; i < 28; i++) loads.set(day(i), i >= 21 ? 100 : 50);
  assert.equal(Math.round(loadRatio(loads, day(27))! * 100) / 100, 1.6);
  const days = Array.from({ length: 28 }, (_, i) => ({ d: day(i), rhr: 47, hrv: 62, hrvLo: 52, hrvHi: 70, score: 81, slp: 7.2 }));
  const a = assess(days, loads)!;
  const t = pushText(a, days[27]);
  assert.equal(t.title, "🔴 Erholung hat Vorrang");
  assert.equal(t.body, "HRV 62 ms · Ruhepuls 47 · Schlaf 7:12 h (Score 81) · Last 1,60");
});

test("Morgen-Push: Uhrzeit, einmal am Tag, auf Schlafdaten warten", () => {
  const cfg = { on: true, time: "09:00" };
  assert.equal(decide(cfg, "2026-11-11", "08:30", "2026-11-11"), "skip");
  assert.equal(decide(cfg, "2026-11-11", "09:00", "2026-11-11"), "send");
  assert.equal(decide(cfg, "2026-11-11", "09:30", "2026-11-10"), "wait");
  assert.equal(decide(cfg, "2026-11-11", "12:00", "2026-11-10"), "send-stale");
  assert.equal(decide({ ...cfg, lastSent: "2026-11-11" }, "2026-11-11", "10:00", "2026-11-11"), "skip");
  assert.equal(decide({ ...cfg, on: false }, "2026-11-11", "10:00", "2026-11-11"), "skip");
});

test("Web Push: aes128gcm lässt sich mit dem Schlüssel des Geräts wieder entschlüsseln (RFC 8291)", async () => {
  const s = crypto.subtle;
  const ua = (await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPub = new Uint8Array(await s.exportKey("raw", ua.publicKey) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload({ endpoint: "https://push.example/x", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } }, '{"title":"Test"}');
  // Gerät: Kopf lesen, Schlüssel ableiten, entschlüsseln
  const salt = body.slice(0, 16), rs = new DataView(body.buffer).getUint32(16), idlen = body[20];
  assert.equal(rs, 4096);
  const asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await s.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await s.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const hk = async (sl: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sl, info }, await s.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const te = new TextEncoder();
  const ikm = await hk(auth, ecdh, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPub, ...asPub]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const pt = new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce }, await s.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.equal(pt[pt.length - 1], 2);
  assert.equal(new TextDecoder().decode(pt.slice(0, -1)), '{"title":"Test"}');
});

test("Web Push: VAPID-Kopfzeile ist ein gültiges ES256-JWT für den Push-Dienst", async () => {
  const s = crypto.subtle;
  const kp = (await s.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = b64u(await s.exportKey("raw", kp.publicKey) as ArrayBuffer);
  const h = await vapidAuth(kp.privateKey, pub, "https://web.push.apple.com/abc", "https://meine-app.example", 1_800_000_000_000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
  assert.ok(m);
  const dec = (x: string) => Uint8Array.from(Buffer.from(x, "base64url"));
  const claims = JSON.parse(new TextDecoder().decode(dec(m[2])));
  assert.deepEqual(claims, { aud: "https://web.push.apple.com", exp: 1_800_043_200, sub: "https://meine-app.example" });
  assert.equal(m[4], pub);
  assert.ok(await s.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, dec(m[3]), new TextEncoder().encode(m[1] + "." + m[2])));
});
