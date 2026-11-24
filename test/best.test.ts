// Tests für die Bestleistungen aus einer synthetischen FIT-Datei (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitParse } from "../src/garmin/extract.ts";

/** Minimale FIT-Datei mit Messpunkten: Zeit (s), Strecke (m), Leistung (W) */
function buildFit(rows: Array<[number, number, number]>): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => body.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => body.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  // Definition lokal 0 → global 20: 253 Zeit, 5 Strecke (cm), 7 Leistung
  body.push(0x40, 0, 0); u16(20); body.push(3, 253, 4, 0x86, 5, 4, 0x86, 7, 2, 0x84);
  for (const [t, m, pw] of rows) { body.push(0x00); u32(t); u32(Math.round(m * 100)); u16(pw); }
  const n = body.length;
  return new Uint8Array([14, 0x10, 0, 0, n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0, ...body, 0, 0]);
}

test("Bestleistungen Lauf: schnellster Abschnitt je Strecke, auch mitten im Lauf", () => {
  // 20 Min. mit 3 m/s, dann 5 Min. mit 4 m/s (1,2 km), dann 10 Min. mit 3 m/s
  const rows: Array<[number, number, number]> = [];
  let t = 1000, m = 0;
  for (let i = 0; i < 1200; i++) rows.push([t++, (m += 3), 0]);
  for (let i = 0; i < 300; i++) rows.push([t++, (m += 4), 0]);
  for (let i = 0; i < 600; i++) rows.push([t++, (m += 3), 0]);
  const { best } = fitParse(buildFit(rows));
  assert.ok(best);
  // 1 km komplett im schnellen Teil: 250 s
  assert.equal(best!.d["1000"], 250);
  // 400 m: 100 s
  assert.equal(best!.d["400"], 100);
  // 5 km: 1,2 km schnell (300 s) + 3,8 km mit 3 m/s (1266,7 s) = 1567 s
  assert.equal(best!.d["5000"], 1567);
  // Länger als der Lauf (6,3 km) gibt es nicht
  assert.equal(best!.d["10000"], undefined);
  // ohne Leistungsmesser keine Watt
  assert.deepEqual(best!.p, {});
});

test("Bestleistungen Rad: höchste Durchschnittsleistung je Zeitfenster, Pausen zählen nicht", () => {
  const rows: Array<[number, number, number]> = [];
  let t = 5000, m = 0;
  for (let i = 0; i < 600; i++) rows.push([t++, (m += 8), 200]);   // 10 Min. 200 W
  for (let i = 0; i < 20; i++) rows.push([t++, (m += 10), 600]);   // 20 s Sprint 600 W
  t += 600;                                                         // 10 Min. Pause (Ampel, Café)
  for (let i = 0; i < 300; i++) rows.push([t++, (m += 9), 300]);   // 5 Min. 300 W
  const { best } = fitParse(buildFit(rows));
  assert.ok(best);
  assert.equal(best!.p["5"], 600);
  assert.equal(best!.p["15"], 600);
  // 30 s: 20 s Sprint + 10 s mit 300 W direkt nach der Pause (die Pause selbst zählt nicht)
  assert.equal(best!.p["30"], 500);
  // 5 Min.: 20 s Sprint + 280 s mit 300 W über die Pause hinweg = 320 W
  assert.equal(best!.p["300"], 320);
  // Ganze Fahrt ohne Pause knapp 15,3 Min. → kein 20-Min.-Wert
  assert.equal(best!.p["1200"], undefined);
  // 5 km: schnellster Abschnitt, Strecke aus der Datei (die Pause liegt dazwischen und zählt nicht)
  assert.ok(best!.d["5000"] > 0 && best!.d["5000"] < 650);
});

test("Bestleistungen: ohne Messpunkte nichts", () => {
  assert.equal(fitParse(buildFit([])).best, null);
});
