// Tests für die Wettkampfprognose (#105) mit drei ausgedachten Läufer-Profilen.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntervals, prognose, raceFromVo2, type PAct, type PDay, type PLap } from "../src/prognose.ts";

const today = "2026-11-13";
const day = (n: number) => new Date(Date.parse(today + "T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const days: PDay[] = Array.from({ length: 30 }, (_, i) => ({ d: day(i), rhr: 45 }));
const lap = (m: number, secPerKm: number, hr: number, extra: Partial<PLap> = {}): PLap =>
  ({ m, s: Math.round((m / 1000) * secPerKm), v: +(1000 / secPerKm).toFixed(3), hr, ...extra });
const run = (d: string, km: number, secPerKm: number, hr: number, more: Partial<PAct> = {}): PAct =>
  ({ date: d, type: "running", km, min: (km * secPerKm) / 60, hr, maxHr: hr + 15, spd: 1000 / secPerKm, gap: 1000 / secPerKm, ...more });

// Strukturiertes Training wie bei Eddie: 2 km einlaufen, 4 × 1200 m in 3:10/km mit 400 m Trab, auslaufen
const structured = (): PLap[] => [
  lap(2000, 300, 140, { it: 2, tg: 0 }),
  ...[0, 1, 2, 3].flatMap((i) => [lap(1200, 190, 176, { it: 0, tg: 0 }), ...(i < 3 ? [lap(400, 375, 150, { it: 4, tg: 0 })] : [])]),
  lap(2000, 330, 145, { it: 3, tg: 7 }),
];
// Normaler Lauf mit Auto-Runden je Kilometer, ein paar schnellere dabei (früher fälschlich als Intervalle erkannt)
const autoLaps = (): PLap[] => [330, 320, 285, 325, 290, 320, 285, 330, 325, 320].map((p, i, a) => lap(1000, p, 160, { it: 0, tg: i === a.length - 1 ? 7 : 2 }));

test("Intervall-Läufer (Eddie): Intervalle sicher erkannt und genutzt, 5 km passend zu 4 × 1200 m in 3:10", () => {
  const acts: PAct[] = [
    run(day(1), 12.4, 192, 175, { vo2: 62, laps: structured() }),
    run(day(3), 12, 240, 160, { vo2: 62 }),
    run(day(5), 16, 280, 150, { vo2: 62 }),
    run(day(8), 12, 240, 160, { vo2: 62 }),
    run(day(10), 10, 245, 158, { vo2: 61 }),
  ];
  const p = prognose({ today, acts, days, hrMax: 190 });
  const iv = p.sources.find((s) => s.key === "intervalle");
  assert.ok(iv && iv.used, "Intervalle zählen mit");
  assert.match(iv.why, /von der Uhr als Intervalle markiert/);
  assert.equal(iv.label, "Intervalle 4 × 1.200 m");
  const five = p.races[0];
  assert.ok(five.sec > 16 * 60 && five.sec < 17 * 60 + 20, "5 km um 16:30, war " + five.sec);
  assert.equal(p.rough, false);
});

test("Dauerläufer mit Auto-Runden (Pablo): keine Intervalle, unpassende Form weggelassen, ≈ Garmin-VO2max", () => {
  const acts: PAct[] = [
    run(day(1), 10, 320, 160, { vo2: 53, laps: autoLaps() }),
    run(day(4), 10, 320, 160, { vo2: 53, laps: autoLaps() }),
    run(day(7), 12, 330, 158, { vo2: 53 }),
    run(day(9), 8, 320, 161, { vo2: 53 }),
  ];
  const p = prognose({ today, acts, days, hrMax: 190 });
  assert.equal(p.sources.find((s) => s.key === "intervalle"), undefined, "Auto-Runden sind keine Intervalle");
  const form = p.sources.find((s) => s.key === "form");
  assert.ok(form && !form.used, "Form weicht stark ab und zählt nicht");
  assert.match(form.why, /passt nicht zu Garmins 53/);
  const onlyGarmin = raceFromVo2(53, 5000);
  assert.ok(Math.abs(p.races[0].sec - onlyGarmin) < 1, "5 km nur aus Garmins VO2max");
});

test("Ohne VO2max (Martin): grobe Schätzung aus den schnellsten Abschnitten", () => {
  const acts: PAct[] = [run(day(2), 6, 300, 0, { hr: null, f5k: 25 * 60 }), run(day(9), 11, 310, 0, { hr: null, f5k: 26 * 60, f10k: 54 * 60 })];
  const p = prognose({ today, acts, days: [], hrMax: null });
  assert.equal(p.rough, true);
  assert.equal(p.sources.length, 0);
  assert.equal(Math.round(p.races[0].sec), 25 * 60);
  assert.ok(p.races.length >= 2);
});

test("Erkennung: ohne Angaben der Uhr nur echtes Muster (schnell und deutlich langsamer im Wechsel)", () => {
  const pattern = [lap(2000, 300, 140), lap(1000, 200, 175), lap(400, 400, 150), lap(1000, 200, 176), lap(400, 400, 150), lap(1000, 200, 177), lap(2000, 320, 145)];
  assert.equal(detectIntervals(pattern)?.cert, "muster");
  const steady = [300, 280, 305, 275, 300, 278, 302].map((p) => lap(1000, p, 160));
  assert.equal(detectIntervals(steady), null, "km-Runden ohne Erholung sind keine Intervalle");
  const manual = pattern.map((l) => ({ ...l, tg: 0 }));
  assert.equal(detectIntervals(manual)?.cert, "manuell");
});

test("Einstellung: „Nur Garmin“ ignoriert eigene Schätzungen, „Mit meinen Intervallen“ zählt sie trotz Abweichung", () => {
  const acts: PAct[] = [run(day(1), 12.4, 192, 175, { vo2: 50, laps: structured() }), run(day(3), 12, 240, 160, { vo2: 50 })];
  const g = prognose({ today, acts, days, hrMax: 190, mode: "garmin" });
  assert.deepEqual(g.sources.map((s) => s.key), ["garmin"]);
  const auto = prognose({ today, acts, days, hrMax: 190, mode: "auto" });
  assert.equal(auto.sources.find((s) => s.key === "intervalle")?.used, false, "62 passt nicht zu 50 → weggelassen");
  const mine = prognose({ today, acts, days, hrMax: 190, mode: "intervalle" });
  const iv = mine.sources.find((s) => s.key === "intervalle");
  assert.ok(iv?.used && Math.abs(iv.vo2 - 57.5) < 0.01, "auf höchstens 15 % über Garmin begrenzt");
});

test("Harte Zeit (Wettkampf): 5 km in 15:48 zieht die Prognose mit, nie langsamer als gelaufen", () => {
  const base: PAct[] = [
    run(day(3), 12, 240, 160, { vo2: 62 }),
    run(day(5), 16, 280, 150, { vo2: 62 }),
    run(day(8), 12, 240, 160, { vo2: 62 }),
  ];
  const before = prognose({ today, acts: base, days, hrMax: 195 }).races[0].sec;
  // Wettkampf gestern: 5,12 km, Schnitt-Puls 185 (95 % vom Maximalpuls), schnellste 5 km 15:47
  const race = run(day(1), 5.12, 190, 185, { f5k: 947 });
  const p = prognose({ today, acts: [...base, race], days, hrMax: 195 });
  const src = p.sources.find((s) => s.key === "wettkampf");
  assert.ok(src && src.used, "harte Zeit zählt");
  assert.match(src.label, /5 km 15:47/);
  assert.ok(p.races[0].sec <= 947, "5 km nicht langsamer als gelaufen, war " + p.races[0].sec);
  assert.ok(p.races[0].sec < before - 20, "deutlich schneller als vorher");
  // Lockerer Lauf mit Bestzeit-Abschnitt (niedriger Puls, langsamer als Garmin) zählt nicht als harte Zeit
  const easy = run(day(2), 10, 300, 140, { f5k: 1500 });
  assert.equal(prognose({ today, acts: [...base, easy], days, hrMax: 195 }).sources.find((s) => s.key === "wettkampf"), undefined);
  // In Strava als Wettkampf markiert zählt auch ohne hohen Puls
  const marked = run(day(4), 10.1, 205, 0, { hr: null, f10k: 2050, race: true });
  assert.ok(prognose({ today, acts: [...base, marked], days, hrMax: 195 }).sources.find((s) => s.key === "wettkampf")?.used);
  // Harte, aber langsamere Zeit (Hitze, Hügel) bremst die Prognose nicht
  const slow = run(day(2), 10.1, 290, 186, { f10k: 2900 });
  const ps = prognose({ today, acts: [...base, slow], days, hrMax: 195 });
  assert.equal(ps.sources.find((s) => s.key === "wettkampf")?.used, false);
  const same = prognose({ today, acts: [...base, { ...slow, f10k: null }], days, hrMax: 195 });
  assert.ok(Math.abs(ps.races[0].sec - same.races[0].sec) < 1, "Prognose wie ohne die Zeit");
  // Nur Garmin: keine eigene Quelle
  assert.deepEqual(prognose({ today, acts: [...base, race], days, hrMax: 195, mode: "garmin" }).sources.map((s) => s.key), ["garmin"]);
});
