// Tests für die Quellenwahl (#119) und die Ampel nur mit WHOOP. Nur ausgedachte Werte.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDaily, priority, type Row } from "../src/quellen.ts";
import { assess, hrvBaseline, recLight } from "../src/ampel.ts";

const R = (day: string, metric: string, source: string, value: number): Row => ({ day, metric, source, value });

test("Quellen: Nachtwerte von WHOOP vor Garmin, Trainings- und Tageswerte von Garmin, Gewicht von Withings", () => {
  const d = pickDaily([
    R("2026-11-10", "slp", "garmin", 7.1), R("2026-11-10", "slp", "whoop", 6.9),
    R("2026-11-10", "rhr", "garmin", 47), R("2026-11-10", "rhr", "whoop", 49),
    R("2026-11-10", "steps", "garmin", 9000),
    R("2026-11-10", "kcal", "garmin", 2600), R("2026-11-10", "kcal", "whoop", 2500),
    R("2026-11-10", "kg", "garmin", 77), R("2026-11-10", "kg", "withings", 76.4),
    R("2026-11-10", "rec", "whoop", 71),
  ]);
  assert.deepEqual(d["2026-11-10"], { d: "2026-11-10", slp: 6.9, rhr: 49, steps: 9000, kcal: 2600, kg: 76.4, rec: 71 });
});

test("Quellen: Nachtwerte auf Wunsch von Garmin", () => {
  const d = pickDaily([R("2026-11-10", "slp", "garmin", 7.1), R("2026-11-10", "slp", "whoop", 6.9)], { night: "garmin" });
  assert.equal(d["2026-11-10"].slp, 7.1);
  assert.deepEqual(priority("slp", { night: "garmin" }).slice(0, 2), ["garmin", "whoop"]);
});

test("Quellen: HRV nicht mischen – ab dem ersten WHOOP-Tag nur WHOOP, Normalbereich aus derselben Quelle", () => {
  const rows: Row[] = [
    // Vorher nur Garmin (bleibt als Historie)
    R("2026-11-01", "hrv", "garmin", 60), R("2026-11-01", "hrvLo", "garmin", 52), R("2026-11-01", "hrvHi", "garmin", 70),
    // Ab hier trägt die Person zusätzlich WHOOP
    R("2026-11-02", "hrv", "garmin", 58), R("2026-11-02", "hrvLo", "garmin", 52), R("2026-11-02", "hrv", "whoop", 75),
    // WHOOP fehlt in dieser Nacht: keine Lücke mit Garmin füllen, auch nicht Garmins Normalbereich
    R("2026-11-03", "hrv", "garmin", 61), R("2026-11-03", "hrvLo", "garmin", 52), R("2026-11-03", "rhr", "garmin", 48),
  ];
  const d = pickDaily(rows);
  assert.deepEqual(d["2026-11-01"], { d: "2026-11-01", hrv: 60, hrvLo: 52, hrvHi: 70, hrvSrc: "garmin" });
  assert.deepEqual(d["2026-11-02"], { d: "2026-11-02", hrv: 75, hrvSrc: "whoop" });
  assert.deepEqual(d["2026-11-03"], { d: "2026-11-03", rhr: 48 });
  // Mit Garmin als Nachtquelle bleibt alles bei Garmin
  const g = pickDaily(rows, { night: "garmin" });
  assert.deepEqual([g["2026-11-02"].hrv, g["2026-11-03"].hrv, g["2026-11-03"].hrvLo], [58, 61, 52]);
});

test("Quellen: ohne bekannte Quelle (Demo) wie bisher", () => {
  const d = pickDaily([R("2026-11-10", "hrv", "demo", 60), R("2026-11-10", "hrvLo", "demo", 52), R("2026-11-10", "slp", "demo", 7)]);
  assert.deepEqual(d["2026-11-10"], { d: "2026-11-10", slp: 7, hrv: 60, hrvLo: 52, hrvSrc: "demo" });
});

// ---------- Ampel nur mit WHOOP ----------
const addDays = (date: string, n: number) => { const t = new Date(date + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function whoopDays(last: Record<string, number>) {
  const days = [];
  for (let i = 59; i >= 1; i--) days.push({ d: addDays("2026-11-10", -i), hrv: 60 + ((i * 7) % 11) - 5, rhr: 50, score: 85, slp: 7.5, rec: 70, hrvSrc: "whoop" });
  days.push({ d: "2026-11-10", hrvSrc: "whoop", ...last });
  return days;
}

test("Ampel: nur WHOOP – Recovery-Farbe wie in der WHOOP-App, HRV gegen den eigenen 60-Tage-Bereich", () => {
  assert.deepEqual([recLight(67), recLight(66), recLight(34), recLight(33)], ["g", "y", "y", "r"]);
  const days = whoopDays({ hrv: 61, rhr: 50, score: 86, slp: 7.6, rec: 72 });
  const b = hrvBaseline(days, "2026-11-10", "whoop")!;
  assert.ok(b.lo < 60 && b.hi > 60 && b.n === 59);
  const a = assess(days, new Map(), [], "2026-11-10T08:00")!;
  assert.equal(a.day, "2026-11-10");
  const it = Object.fromEntries(a.items.map((i) => [i.key, i.st]));
  assert.deepEqual([it.hrv, it.rec, it.rhr, it.score], ["g", "g", "g", "g"]);
  assert.match(a.items.find((i) => i.key === "hrv")!.why, /eigener Normalbereich/);
  assert.equal(a.light, "g");
});

test("Ampel: niedrige WHOOP-Recovery macht rot", () => {
  const a = assess(whoopDays({ hrv: 61, rhr: 50, score: 86, slp: 7.6, rec: 25 }), new Map(), [], "2026-11-10T08:00")!;
  assert.equal(a.items.find((i) => i.key === "rec")!.st, "r");
  assert.equal(a.light, "r");
});

test("Ampel: zu wenig eigene Nächte → HRV ohne Bewertung; Einheiten ohne Trainingseffekt → Erholung „fehlt“", () => {
  const days = [{ d: "2026-11-09", hrv: 60, hrvSrc: "whoop" }, { d: "2026-11-10", hrv: 62, rec: 80, score: 90, slp: 8, hrvSrc: "whoop" }];
  const a = assess(days, new Map(), [{ date: "2026-11-09", start: "18:00", min: 50, te: null }], "2026-11-10T08:00")!;
  const hrv = a.items.find((i) => i.key === "hrv")!, rec = a.items.find((i) => i.key === "recovery")!;
  assert.deepEqual([hrv.st, hrv.val], ["", "62 ms"]);
  assert.deepEqual([rec.st, rec.val], ["", "fehlt"]);
});

test("Ampel: Garmin unverändert – eigener Normalbereich nur ohne Garmins Bereich", () => {
  const days = whoopDays({}).map((x) => ({ ...x, hrvSrc: "garmin", rec: undefined }));
  days[days.length - 1] = { d: "2026-11-10", hrv: 50, hrvWk: 55, hrvLo: 52, hrvHi: 70, rhr: 50, score: 85, slp: 7.5, hrvSrc: "garmin", rec: undefined };
  const a = assess(days, new Map(), undefined, undefined)!;
  const hrv = a.items.find((i) => i.key === "hrv")!;
  assert.match(hrv.why, /Normalbereich 52–70 ms\./);
  assert.equal(a.items.some((i) => i.key === "rec"), false);
});
