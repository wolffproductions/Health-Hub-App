// Tests für Erholungs-Ampel, Morgen-Push-Zeitplan und Web-Push-Verschlüsselung (synthetische Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, loadRatio, pushText, readiness } from "../src/ampel.ts";
import { decide, decideAuto } from "../src/ampel.ts";
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
  assert.match(t.title, /^🔴 Bereitschaft \d{1,2} · Erholung hat Vorrang$/);
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

test("Morgen-Push automatisch: sobald Schlaf (und HRV) da sind, spätestens zur eingestellten Zeit", () => {
  const cfg = { on: true, latest: "11:00" };
  const n = (sleep: boolean, hrv: boolean, sleepSeenMin: number | null = null, hrvUsual = true) => ({ sleep, hrv, hrvUsual, sleepSeenMin });
  // Nacht läuft noch: nie vor 3 Uhr, auch nicht mit Werten
  assert.equal(decideAuto(cfg, "2026-11-11", "02:30", n(true, true)), "skip");
  // Noch nichts da → warten
  assert.equal(decideAuto(cfg, "2026-11-11", "06:10", n(false, false)), "wait");
  // Schlaf und HRV da → sofort senden
  assert.equal(decideAuto(cfg, "2026-11-11", "06:40", n(true, true, 0)), "send");
  // Schlaf da, HRV fehlt noch → kurz warten, nach 45 Minuten ohne HRV senden
  assert.equal(decideAuto(cfg, "2026-11-11", "06:40", n(true, false, 10)), "wait");
  assert.equal(decideAuto(cfg, "2026-11-11", "07:30", n(true, false, 50)), "send");
  // Wer sonst keine HRV hat (Uhr ohne HRV), bekommt den Bericht direkt mit dem Schlaf
  assert.equal(decideAuto(cfg, "2026-11-11", "06:40", n(true, false, 0, false)), "send");
  // Bis „spätestens“ nichts da → mit dem letzten Stand
  assert.equal(decideAuto(cfg, "2026-11-11", "11:00", n(false, false)), "send-stale");
  // Einmal am Tag, nur wenn eingeschaltet
  assert.equal(decideAuto({ ...cfg, lastSent: "2026-11-11" }, "2026-11-11", "07:00", n(true, true)), "skip");
  assert.equal(decideAuto({ ...cfg, on: false }, "2026-11-11", "07:00", n(true, true)), "skip");
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

// Erholungszeit (#107), ausgedachte Werte nach dem Muster von Eddies Intervall-Dienstag
test("Erholungszeit: nach harten Intervallen am Abend morgens gelb, zwei Tage später grün", () => {
  const D = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;
  const days = Array.from({ length: 31 }, (_, i) => ({ d: new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10), rhr: 42, hrv: 77, hrvLo: 73, hrvHi: 95, score: 88, slp: 8 }));
  const loads = new Map(days.map((x) => [x.d, 60]));
  const easy = [3, 5, 7, 8].map((d) => ({ date: D(d), start: "09:00", min: 50, te: 2.5, teAn: 0, load: 90, name: "Dauerlauf" }));
  const hard = { date: D(10), start: "18:45", min: 58.5, te: 3.9, teAn: 3.8, load: 304, name: "Intervalle" };
  const acts = [...easy, hard];
  const upTo = (d: string) => days.filter((x) => x.d <= d);
  // Mittwochmorgen: noch rund 45 h offen → höchstens moderat, obwohl HRV, Ruhepuls und Schlaf gut sind
  let a = assess(upTo(D(11)), loads, acts)!;
  const rec = a.items.find((i) => i.key === "recovery")!;
  assert.equal(rec.st, "y");
  assert.match(rec.val, /^noch ca\. 4\d h$/);
  assert.match(rec.why, /Nach „Intervalle“ am 10\.11\./);
  assert.equal(a.verdict, "Moderat trainieren");
  assert.match(pushText(a, days.find((x) => x.d === D(11))).body, /Erholung noch ca\. 4\d h/);
  // Donnerstag noch gelb, Freitag abgeschlossen
  assert.equal(assess(upTo(D(12)), loads, acts)!.items.find((i) => i.key === "recovery")!.st, "y");
  a = assess(upTo(D(13)), loads, acts)!;
  assert.equal(a.items.find((i) => i.key === "recovery")!.val, "abgeschlossen");
  assert.equal(a.light, "g");
});

test("Erholungszeit: lockere Einheit kaum, ohne Einheiten kein zusätzlicher Punkt; Body Battery beim Aufwachen", () => {
  const days = Array.from({ length: 31 }, (_, i) => ({ d: day(i), rhr: 48, hrv: 62, hrvLo: 52, hrvHi: 70, score: 85, slp: 7.5 }));
  const loads = new Map(days.map((x) => [x.d, 50]));
  const easy = { date: day(29), start: "18:00", min: 40, te: 2.2, teAn: 0, load: 50, name: "Locker" };
  assert.equal(assess(days, loads, [easy])!.items.find((i) => i.key === "recovery")!.val, "abgeschlossen");
  assert.equal(assess(days, loads)!.items.some((i) => i.key === "recovery"), false);
  const low = assess([...days.slice(0, 30), { ...days[30], bbWake: 25 }], loads)!;
  assert.equal(low.items.find((i) => i.key === "bb")!.st, "r");
  assert.equal(low.verdict, "Erholung hat Vorrang");
});

// Nachbesserung nach Eddies Hinweis: Erholung zur aktuellen Uhrzeit, HRV im Normalbereich grün
test("Erholungszeit zur aktuellen Uhrzeit: Freitag 1:20 nach dem Intervall-Dienstag nur noch wenige Stunden", () => {
  const D = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;
  const days = Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10), rhr: 42, hrv: 75, hrvLo: 73, hrvHi: 94, score: 93, slp: 8 }));
  const loads = new Map(days.map((x) => [x.d, 60]));
  const acts = [...[3, 5, 7, 8].map((d) => ({ date: D(d), start: "09:00", min: 50, te: 2.5, teAn: 0, load: 90, name: "Dauerlauf" })),
    { date: D(10), start: "18:45", min: 58.5, te: 3.9, teAn: 3.8, load: 304, name: "Intervalle" }];
  // Letzte Nacht mit Daten ist die auf Donnerstag (12.11.), jetzt ist Freitag 1:20
  const a = assess(days, loads, acts, "2026-11-13T01:20")!;
  assert.equal(a.day, "2026-11-12");
  const rec = a.items.find((i) => i.key === "recovery")!;
  assert.equal(rec.val, "noch ca. 3 h");
  assert.equal(rec.st, "g");
  assert.match(rec.why, /Stand 01:20 Uhr/);
  assert.equal(a.items.find((i) => i.key === "hrv")!.st, "g", "HRV 75 im Bereich 73–94 ist grün");
  assert.equal(a.light, "g");
  // Ohne Uhrzeit wie bisher 7 Uhr am Morgen der Nacht: Donnerstag 7 Uhr noch gut 20 h
  assert.match(assess(days, loads, acts)!.items.find((i) => i.key === "recovery")!.val, /^noch ca\. 2\d h$/);
});

test("HRV wie Garmins Status: im Bereich grün, darunter gelb, mehr als 10 % darunter rot", () => {
  const base = Array.from({ length: 31 }, (_, i) => ({ d: day(i), rhr: 48, hrvLo: 73, hrvHi: 94, score: 85, slp: 7.5, hrv: 80 }));
  const loads = new Map(base.map((x) => [x.d, 50]));
  const st = (hrv: number) => assess([...base.slice(0, 30), { ...base[30], hrv }], loads)!.items.find((i) => i.key === "hrv")!.st;
  assert.equal(st(73), "g");
  assert.equal(st(75), "g");
  assert.equal(st(98), "g");
  assert.equal(st(70), "y");
  assert.equal(st(65), "r");
});

// Nachbesserung: eine einzelne niedrige Nacht (z. B. nach einem Wettkampf) macht höchstens gelb,
// rot erst mit niedrigem Wochenschnitt oder sehr kurzem Schlaf
test("HRV über den Wochenschnitt, sehr kurzer Schlaf bleibt rot", () => {
  const base = Array.from({ length: 31 }, (_, i) => ({ d: day(i), rhr: 42, hrv: 80, hrvWk: 80, hrvLo: 73, hrvHi: 94, score: 89, slp: 8.4 }));
  const loads = new Map(base.map((x) => [x.d, 50]));
  const at = (x: object) => assess([...base.slice(0, 30), { ...base[30], ...x }], loads)!;
  // Nach dem Wettkampf: Nacht 65 ms, Woche 74 ms im Bereich, Ruhepuls +4 → moderat statt rot
  let a = at({ hrv: 65, hrvWk: 74, rhr: 46 });
  assert.equal(a.items.find((i) => i.key === "hrv")!.st, "y");
  assert.equal(a.light, "y");
  assert.equal(a.verdict, "Moderat trainieren");
  // Wochenschnitt schon unter dem Bereich und Nacht deutlich darunter → rot
  assert.equal(at({ hrv: 62, hrvWk: 70 }).items.find((i) => i.key === "hrv")!.st, "r");
  // Wochenschnitt mehr als 10 % unter dem Bereich → rot, auch bei guter Nacht
  assert.equal(at({ hrv: 80, hrvWk: 64 }).items.find((i) => i.key === "hrv")!.st, "r");
  // Nur 3 h Schlaf → rot, auch bei sonst guten Werten
  a = at({ slp: 3, score: 85 });
  assert.equal(a.items.find((i) => i.key === "score")!.st, "r");
  assert.equal(a.light, "r");
  // 6 h → gelb
  assert.equal(at({ slp: 6 }).items.find((i) => i.key === "score")!.st, "y");
});

test("Bereitschaft 0–100: Bausteine, fehlende Werte, Zahl passt immer zur Ampelfarbe", () => {
  const top = readiness({ hrv: 80, hrvWk: 78, hrvLo: 70, score: 90, slp: 8, recH: 0, ratio: 1, rhr: 42, rhrBase: 42, bb: 95 }, "g");
  assert.equal(top.score, 97); // Schlafscore 90 und Body Battery 95 kosten zusammen knapp 3 Punkte
  assert.equal(top.parts.reduce((t, p) => t + p.max, 0), 100);
  assert.deepEqual(top.parts.map((p) => p.key), ["hrv", "sleep", "recovery", "load", "rhr", "bb"]);
  // offene Erholung 24 h und kurzer Schlaf kosten Punkte
  const tired = readiness({ hrv: 80, hrvWk: 78, hrvLo: 70, score: 70, slp: 6, recH: 24, ratio: 1, rhr: 42, rhrBase: 42 }, "g");
  assert.ok(tired.score! < top.score! && tired.score! >= 70, "grün bleibt 70–100: " + tired.score);
  assert.equal(tired.parts.find((p) => p.key === "recovery")!.pts, Math.round(tired.parts.find((p) => p.key === "recovery")!.max / 2));
  // gleiche Werte, aber Ampel rot → Zahl unter 40; gelb → 40–69
  assert.ok(readiness({ hrv: 80, hrvLo: 70, score: 90, slp: 8 }, "r").score! <= 39);
  const y = readiness({ hrv: 80, hrvLo: 70, score: 90, slp: 8 }, "y").score!;
  assert.ok(y >= 40 && y <= 69);
  // ohne Body Battery: Gewichte werden hochgerechnet
  const nobb = readiness({ hrv: 80, hrvLo: 70, score: 90, slp: 8 }, "g");
  assert.equal(nobb.parts.reduce((t, p) => t + p.max, 0), 100);
  // zu wenig Bausteine oder keine Ampel → keine Zahl
  assert.equal(readiness({ score: 90 }, "g").score, null);
  assert.equal(readiness({ hrv: 80, hrvLo: 70, score: 90 }, "").score, null);
});
