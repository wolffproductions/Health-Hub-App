// Tests für das Lesen von Runden und Route aus einer synthetischen FIT-Datei (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitParse, ROUTE_MAX_POINTS } from "../src/garmin/extract.ts";

const SEMI = 2 ** 31 / 180;

/** Baut eine minimale FIT-Datei: Messpunkte (Nachricht 20) und eine Runde (Nachricht 19) */
function buildFit(points: Array<[number, number] | null>, lap: { ms: number; cm: number; hr: number }): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => body.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => body.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  // Definition lokal 0 → global 20: Feld 0 und 1 (sint32), Feld 3 (uint8)
  body.push(0x40, 0, 0); u16(20); body.push(3, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 0x02);
  for (const pt of points) {
    body.push(0x00);
    if (pt) { u32(Math.round(pt[0] * SEMI) | 0); u32(Math.round(pt[1] * SEMI) | 0); } else { u32(0x7fffffff); u32(0x7fffffff); }
    body.push(140);
  }
  // Definition lokal 1 → global 19: Feld 7 und 9 (uint32), Feld 15 (uint8)
  body.push(0x41, 0, 0); u16(19); body.push(3, 7, 4, 0x86, 9, 4, 0x86, 15, 1, 0x02);
  body.push(0x01); u32(lap.ms); u32(lap.cm); body.push(lap.hr);
  const head = [14, 0x10, 0, 0, ...[body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, 0], 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...head, ...body, 0, 0]);
}

// Ausgedachte Schleife (Kreis), Mittelpunkt mit negativer Länge, um Vorzeichen zu prüfen
const circle = (n: number): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [50 + 0.01 * Math.sin((i / n) * 2 * Math.PI), -0.5 + 0.015 * Math.cos((i / n) * 2 * Math.PI)]);

test("Route: Koordinaten mit Vorzeichen, ungültige Punkte übersprungen", () => {
  const pts = circle(50);
  const withGaps: Array<[number, number] | null> = [null, ...pts.slice(0, 25), null, ...pts.slice(25)];
  const { route } = fitParse(buildFit(withGaps, { ms: 600000, cm: 200000, hr: 150 }));
  assert.equal(route.length, 50);
  assert.deepEqual(route[0], [Number(pts[0][0].toFixed(5)), Number(pts[0][1].toFixed(5))]);
  assert.ok(route.every(([la, lo]) => la > 49.9 && la < 50.1 && lo < 0), "Länge muss negativ bleiben");
});

// Abstand eines Punkts zur Linie a–b in Metern (gleiche Umrechnung wie im Extraktor)
const toXY = (p: [number, number], lat0: number): [number, number] => [p[1] * 111320 * Math.cos((lat0 * Math.PI) / 180), p[0] * 110540];
function distToPolyline(p: [number, number], line: Array<[number, number]>, lat0: number): number {
  const [px, py] = toXY(p, lat0);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toXY(line[i - 1], lat0), [bx, by] = toXY(line[i], lat0);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}

test("Route: lange Spur wird ausgedünnt, bleibt aber genau (≤ ~3 m Abweichung), Start und Ziel bleiben", () => {
  const pts = circle(3600);
  const { route } = fitParse(buildFit(pts, { ms: 3600000, cm: 1000000, hr: 145 }));
  assert.ok(route.length < 1000 && route.length <= ROUTE_MAX_POINTS, `Länge ${route.length}`);
  const r5 = (p: [number, number]) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))];
  assert.deepEqual(route[0], r5(pts[0]));
  assert.deepEqual(route[route.length - 1], r5(pts[pts.length - 1]));
  const worst = Math.max(...pts.map((p) => distToPolyline(p, route, 50)));
  assert.ok(worst <= 3, `größte Abweichung ${worst.toFixed(2)} m`);
});

test("Route: Ecken bleiben erhalten (rechter Winkel wird nicht abgeschnitten)", () => {
  // 400 m nach Norden, dann 400 m nach Osten, ein Punkt pro Meter
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 400; i++) pts.push([50 + i / 110540, 8]);
  for (let i = 1; i <= 400; i++) pts.push([50 + 400 / 110540, 8 + i / (111320 * Math.cos((50 * Math.PI) / 180))]);
  const { route } = fitParse(buildFit(pts, { ms: 600000, cm: 80000, hr: 140 }));
  assert.ok(route.length <= 5, `Länge ${route.length}`);
  const corner = pts[400];
  assert.ok(route.some(([la, lo]) => Math.abs(la - corner[0]) < 2e-5 && Math.abs(lo - corner[1]) < 2e-5), "Eckpunkt fehlt");
});

test("Route: sehr kurvige Spur bleibt unter der Obergrenze", () => {
  const pts: Array<[number, number]> = Array.from({ length: 20000 }, (_, i) => [50 + i * 1e-6, 8 + (i % 2 ? 1e-4 : 0)]);
  const { route } = fitParse(buildFit(pts, { ms: 600000, cm: 80000, hr: 140 }));
  assert.ok(route.length <= ROUTE_MAX_POINTS, `Länge ${route.length}`);
});

test("ohne GPS (z. B. Laufband): leere Route, Runden trotzdem gelesen", () => {
  const { route, laps } = fitParse(buildFit([null, null, null], { ms: 600000, cm: 200000, hr: 150 }));
  assert.deepEqual(route, []);
  assert.equal(laps.length, 1);
  assert.equal(laps[0].hr, 150);
  assert.equal(laps[0].s, 600);
  assert.equal(laps[0].v, 3.333);
  assert.equal(laps[0].m, 2000);
});
