// Tests für die Verläufe über die Strecke aus einer synthetischen FIT-Datei (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitParse, STREAM_MAX_POINTS } from "../src/garmin/extract.ts";

/** Minimale FIT-Datei mit Messpunkten: Zeit (s), Puls, Strecke (m), Tempo (m/s), Höhe (m), Leistung (W) */
function buildFit(rows: Array<[number, number, number, number, number, number]>): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => body.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => body.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  // Definition lokal 0 → global 20: 253 Zeit, 3 Puls, 5 Strecke (cm), 6 Tempo (mm/s), 2 Höhe (÷5 − 500), 7 Leistung
  body.push(0x40, 0, 0); u16(20); body.push(6, 253, 4, 0x86, 3, 1, 0x02, 5, 4, 0x86, 6, 2, 0x84, 2, 2, 0x84, 7, 2, 0x84);
  for (const [t, hr, m, v, alt, pw] of rows) { body.push(0x00); u32(t); body.push(hr); u32(Math.round(m * 100)); u16(Math.round(v * 1000)); u16(Math.round((alt + 500) * 5)); u16(pw); }
  const n = body.length;
  return new Uint8Array([14, 0x10, 0, 0, n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0, ...body, 0, 0]);
}

test("Verläufe: nach Strecke gemittelt, Pausen zählen nicht zur Zeit, Höhe umgerechnet", () => {
  const rows: Array<[number, number, number, number, number, number]> = [];
  let t = 5000, m = 0;
  for (let i = 0; i < 600; i++) rows.push([t++, 140 + (i % 10), (m += 3), 3, 20 + i / 60, 200]); // 10 Min., 1,8 km
  t += 300;                                                                                         // 5 Min. Pause
  for (let i = 0; i < 600; i++) rows.push([t++, 160, (m += 3.5), 3.5, 30, 250]);                  // 10 Min., 2,1 km
  const { streams } = fitParse(buildFit(rows));
  assert.ok(streams);
  const s = streams!;
  assert.equal(s.t.length, STREAM_MAX_POINTS);
  for (const k of ["d", "v", "hr", "alt", "pw"] as const) assert.equal(s[k]!.length, s.t.length, k);
  assert.equal(s.cad, undefined); // keine Kadenz in der Datei → Reihe fehlt
  assert.equal(s.t[s.t.length - 1], 1198); // 2 × 599 s zwischen den Punkten, die Pause von 5 Minuten zählt nicht
  assert.ok(Math.abs(s.d![s.d!.length - 1]! - 3897) <= 1);
  assert.equal(s.v![0], 3);
  assert.equal(s.v![s.v!.length - 1], 3.5);
  assert.equal(s.alt![s.alt!.length - 1], 30);
  assert.equal(s.pw![s.pw!.length - 1], 250);
});

test("Verläufe: ohne Messpunkte keine Reihen", () => {
  assert.equal(fitParse(buildFit([])).streams, null);
});
