// Tests für die sekundengenaue Pulsverteilung aus einer synthetischen FIT-Datei (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitParse, zoneTotals } from "../src/garmin/extract.ts";

/** Minimale FIT-Datei mit Messpunkten: Zeit (s), Puls (bpm), Strecke (m) */
function buildFit(rows: Array<[number, number, number]>): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => body.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => body.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  // Definition lokal 0 → global 20: Feld 253 (uint32), 3 (uint8), 5 (uint32, cm)
  body.push(0x40, 0, 0); u16(20); body.push(3, 253, 4, 0x86, 3, 1, 0x02, 5, 4, 0x86);
  for (const [t, hr, m] of rows) { body.push(0x00); u32(t); body.push(hr); u32(Math.round(m * 100)); }
  const n = body.length;
  return new Uint8Array([14, 0x10, 0, 0, n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0, ...body, 0, 0]);
}

test("Puls-Histogramm: Sekunden und Meter je bpm, Pausen über 10 s zählen nicht, Stehen zählt nur als Zeit", () => {
  const rows: Array<[number, number, number]> = [];
  let t = 1000, m = 0;
  for (let i = 0; i < 60; i++) rows.push([t++, 140, (m += 3)]);   // 60 s bei 140 bpm, 3 m/s
  t += 120;                                                        // 2 Minuten Pause
  for (let i = 0; i < 30; i++) rows.push([t++, 170, (m += 4)]);   // 30 s bei 170 bpm, 4 m/s
  for (let i = 0; i < 20; i++) rows.push([t++, 170, (m += 0.2)]); // 20 s Stehen an der Ampel
  const { hist } = fitParse(buildFit(rows));
  const at = (bpm: number) => hist.find((h) => h[0] === bpm);
  assert.deepEqual(at(140), [140, 59, 177, 59]);  // erster Punkt ohne Vorgänger zählt nicht
  assert.deepEqual(at(170), [170, 49, 116, 29]);  // Sprung über die Pause zählt nicht, Stehen nur als Zeit
  assert.equal(hist.length, 2);
});

test("Zonen: fünf Zonen aus den drei eigenen Bereichen (wie Strava)", () => {
  const zones = [[129, 160], [161, 175], [176, 191]];
  const hist: Array<[number, number, number, number]> = [[120, 60, 150, 50], [129, 10, 30, 10], [160, 20, 60, 20], [161, 5, 20, 5], [176, 7, 30, 7], [191, 3, 12, 3], [192, 1, 5, 1]];
  assert.deepEqual(zoneTotals(hist, zones), [[60, 150, 50], [30, 90, 30], [5, 20, 5], [10, 42, 10], [1, 5, 1]]);
});
