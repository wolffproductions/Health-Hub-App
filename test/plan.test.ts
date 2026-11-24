// Tests für den Trainingsplan (#20), synthetische Läufer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, checkOff, dayLayout, feasibility, hrPace, paces, sameDist, zonesFrom, raceFromVdot, vdotFromRace, type Goal } from "../src/plan.ts";

test("Plan: Daniels-Werte stimmen mit der Tabelle überein", () => {
  // VDOT 50 ≈ 5 km in 19:57, Halbmarathon ≈ 1:32 (Daniels' Tabelle)
  assert.ok(Math.abs(raceFromVdot(50, 5000) - 1197) < 15);
  assert.ok(Math.abs(raceFromVdot(50, 21097) - 5520) < 60);
  assert.ok(Math.abs(vdotFromRace(5000, 1197) - 50) < 0.3);
  const p = paces(50);
  // Schwelle ~4:15, Intervalle ~3:55, locker langsamer als Marathon, Marathon langsamer als Schwelle
  assert.ok(p.t > 245 && p.t < 265, "T " + p.t);
  assert.ok(p.i > 225 && p.i < 245, "I " + p.i);
  assert.ok(p.e[0] > p.m && p.m > p.t && p.t > p.i && p.i > p.r);
});

test("Plan: Einschätzung realistisch / ambitioniert / sehr ambitioniert", () => {
  const f = feasibility(50, 21097, 12, null);
  assert.ok(f.now! > f.hi! && f.hi! > f.lo!); // mehr Training = schneller
  assert.equal(feasibility(50, 21097, 12, f.now! - 10).rating, "realistisch");
  assert.equal(feasibility(50, 21097, 12, f.lo! + 5).rating, "ambitioniert");
  assert.equal(feasibility(50, 21097, 12, f.lo! - 300).rating, "sehr ambitioniert");
  assert.equal(feasibility(null, 21097, 12, 5400).rating, null);
});

test("Plan: Wochentage – langer Lauf fest, harte Einheiten nicht daneben", () => {
  const l = dayLayout(5, 6); // Sonntag langer Lauf
  assert.equal(l.long, 6);
  assert.equal(l.hard.length, 2);
  for (const h of l.hard) assert.ok(h !== 0 && h !== 5, "nicht Mo/Sa direkt neben So: " + h);
  assert.equal(l.hard.length + l.easy.length + 1, 5);
});

const goal = (o: Partial<Goal> = {}): Goal => ({ kind: "race", dist: 21097, date: "2027-02-21", target: 5400, days: 5, longDay: 6, created: "2026-11-18", ...o });

test("Plan: Halbmarathon in 14 Wochen – Phasen, Umfang wächst vorsichtig, Taper, Wettkampf am Tag", () => {
  const p = buildPlan(goal(), { vdot: 50, weekKm: 35, longKm: 14 });
  assert.equal(p.weeks.length, 14);
  assert.equal(p.weeks[0].start, "2026-11-16"); // Montag der Woche
  assert.equal(p.weeks[0].phase, "Grundlage");
  assert.equal(p.weeks[13].phase, "Taper");
  assert.equal(p.weeks[12].phase, "Taper");
  assert.ok(p.weeks.some((w) => w.phase === "Aufbau") && p.weeks.some((w) => w.phase === "Spitze"));
  // nie mehr als ~10 % mehr als die Vorwoche (außer nach einer leichten Woche)
  for (let i = 1; i < p.weeks.length; i++) if (!p.weeks[i - 1].easy) assert.ok(p.weeks[i].km <= p.weeks[i - 1].km * 1.12 + 1, "Woche " + (i + 1));
  // jede 4. Woche leichter
  assert.ok(p.weeks[3].easy && p.weeks[3].km < p.weeks[2].km);
  // langer Lauf nie über 22 km, höchstens 2 harte Einheiten
  for (const w of p.weeks) {
    for (const s of w.sessions) if (s.type === "long" || s.type === "mp") assert.ok(s.km <= 22);
    assert.ok(w.sessions.filter((s) => ["tempo", "interval"].includes(s.type)).length <= 2);
    assert.equal(w.sessions.length, 5);
  }
  const last = p.weeks[13].sessions;
  assert.equal(last[last.length - 1].type, "race");
  assert.equal(last[last.length - 1].date, "2027-02-21");
  assert.ok(last.every((s) => s.date <= "2027-02-21"));
  assert.ok(p.weeks[13].km < p.weeks[11].km); // Taper weniger Umfang
});

test("Plan: langer Lauf nie mehr als 40 % der Woche, auch nach einem einzelnen langen Lauf", () => {
  const p = buildPlan(goal(), { vdot: 50, weekKm: 20, longKm: 16 });
  for (const w of p.weeks) for (const s of w.sessions) if (s.type === "long") assert.ok(s.km <= w.km * 0.42, w.start + " " + s.km + "/" + w.km);
});

test("Plan: Spitzenumfang wächst mit der Form, eigene Vorgabe wird erreicht, aber nicht überschritten", () => {
  const top = (v: number, peak?: number) => Math.max(...buildPlan(goal({ peak }), { vdot: v, weekKm: 39, longKm: 16 }).weeks.map((w) => w.km));
  assert.ok(top(64) > top(50) + 10, top(64) + " vs " + top(50));
  const own = top(64, 70);
  assert.ok(own >= 66 && own <= 71, "Vorgabe 70: " + own);
});

test("Plan: Fit bleiben und ohne Form trotzdem ein Plan", () => {
  const fit = buildPlan(goal({ kind: "fit", dist: undefined, date: undefined, target: null, days: 3 }), { vdot: 45, weekKm: 20, longKm: 10 });
  assert.equal(fit.weeks.length, 8);
  assert.ok(fit.weeks.every((w) => w.phase === "Erhalt" && w.sessions.length === 3));
  const none = buildPlan(goal(), { vdot: null, weekKm: 0, longKm: 0 });
  assert.equal(none.paces, null);
  assert.ok(none.weeks[0].sessions[0].detail.length > 0);
});

test("Plan: fehlende Ausdauer macht „heute“ langsamer, der Plan holt sie als Fortschritt auf", () => {
  const ohne = feasibility(64, 21097, 16, 4320), mit = feasibility(64, 21097, 16, 4320, 0.035);
  assert.ok(mit.now! > ohne.now! * 1.03, "heute langsamer");
  // nach 16 Wochen ist die Lücke im besten Fall geschlossen, die Spanne nach Plan bleibt nah an der vollen Form
  assert.ok(Math.abs(mit.lo! - ohne.lo!) < 1);
  assert.ok(mit.now! - mit.lo! > ohne.now! - ohne.lo! + 100, "mehr Fortschritt mit Ausdauerlücke");
});

test("Plan: Halbmarathon aus der Prognose (21097,5 m) passt zum Plan (21097 m)", () => {
  assert.ok(sameDist(21097.5, 21097));
  assert.ok(!sameDist(10000, 21097) && !sameDist(42195, 21097));
});

// synthetischer Läufer: Maximalpuls 192, Pace steigt um 4 s/km je Schlag weniger
const Z = zonesFrom({ max: 192 });
const sample = (date: string, hr: number) => ({ date, hr, pace: 270 + (160 - hr) * 4, sec: 600 });
const runs = (today: string, shift = 0) => [130, 140, 150, 160, 170, 135, 155].map((h, i) => ({ ...sample("2026-11-" + String(10 + i).padStart(2, "0"), h), pace: 270 + (160 - h) * 4 - shift }));

test("Plan: lockere Pace aus eigenen Läufen bei Zone-2-Puls, nicht aus der 5-km-Form", () => {
  assert.deepEqual(Z!.z2, [134, 152]); // 70–79 % vom Maximalpuls, nicht Garmins Zone 2
  const hr = hrPace(runs("2026-11-18"), "2026-11-18", Z);
  // 134–152 bpm → 302–374 s/km, auf höchstens 45 s Spanne gekürzt
  assert.equal(hr.e![0], 302);
  assert.equal(hr.e![1], 302 + 45);
  const p = paces(65, hr);
  assert.equal(p.src, "puls");
  assert.ok(p.e[0] > p.m + 15, "locker deutlich langsamer als Marathontempo");
  // fitter: gleiche Pulse, 10 s schneller → lockere Pace zieht mit
  assert.equal(hrPace(runs("2026-11-18", 10), "2026-11-18", Z).e![0], 292);
  // zu wenig Daten → vorsichtig aus dem Marathontempo, mit Pulszone im Text
  const none = paces(65, hrPace([], "2026-11-18", Z));
  assert.equal(none.src, "form");
  assert.equal(none.e[0], none.m + 45);
  const plan = buildPlan(goal(), { vdot: 65, weekKm: 50, longKm: 16, hr: hrPace(runs("2026-11-18"), "2026-11-18", Z) });
  const easy = plan.weeks[1].sessions.find((s) => s.type === "easy")!;
  assert.match(easy.detail, /5:02–5:47 \/km \(134–152 bpm\)/);
});

test("Plan: Start-Umfang selbst gewählt, fester Intervall-Tag immer belegt", () => {
  const p = buildPlan(goal({ startKm: 50, peak: 75, hardDay: 1 }), { vdot: 65, weekKm: 39, longKm: 16 });
  assert.ok(Math.abs(p.weeks[0].km - 50) <= 2, "Start " + p.weeks[0].km);
  for (const w of p.weeks.slice(0, -2)) {
    const tue = w.sessions.find((s) => new Date(s.date + "T12:00:00Z").getUTCDay() === 2);
    assert.equal(tue?.type, "interval", w.start);
  }
  const l = dayLayout(5, 6, 1);
  assert.equal(l.hard[0], 1);
  assert.ok(!l.hard.includes(0) && !l.hard.includes(2) && !l.hard.includes(5), "zweiter harter Tag mit Abstand: " + l.hard);
});

test("Plan: Einheiten verschieben (frei) und tauschen (belegt), Wettkampf bleibt", () => {
  const base = buildPlan(goal({ hardDay: 1 }), { vdot: 50, weekKm: 35, longKm: 14 });
  const tue = base.weeks[2].sessions.find((s) => s.type === "interval")!;
  const moved = buildPlan(goal({ hardDay: 1, moves: { [tue.date]: "2026-12-03" } }), { vdot: 50, weekKm: 35, longKm: 14 });
  const w = moved.weeks[2].sessions;
  assert.equal(w.find((s) => s.type === "interval")!.date, "2026-12-03");
  assert.equal(w.length, base.weeks[2].sessions.length);
  assert.equal(new Set(w.map((s) => s.date)).size, w.length, "kein Tag doppelt");
  const race = buildPlan(goal({ moves: { "2027-02-21": "2027-02-20" } }), { vdot: 50, weekKm: 35, longKm: 14 });
  assert.equal(race.weeks[13].sessions.find((s) => s.type === "race")!.date, "2027-02-21");
});

test("Plan: Pause bei Krankheit – keine Einheiten, danach locker und weniger Umfang", () => {
  const cur = { vdot: 50, weekKm: 35, longKm: 14 };
  const base = buildPlan(goal(), cur);
  const p = buildPlan(goal({ pauses: [{ from: "2026-11-30", to: "2026-12-06", kind: "krank" }] }), cur);
  assert.equal(p.weeks[2].sessions.length, 0);
  assert.equal(p.weeks[2].pause, "krank");
  assert.ok(p.weeks[3].comeback);
  assert.ok(p.weeks[3].sessions.every((s) => !["tempo", "interval"].includes(s.type)), "nach Krankheit nichts Hartes");
  assert.ok(p.weeks[4].km < base.weeks[4].km, "Umfang steigt langsamer wieder ein");
  const u = buildPlan(goal({ pauses: [{ from: "2026-11-30", to: "2026-12-06", kind: "urlaub" }] }), cur);
  assert.ok(u.weeks[3].km > p.weeks[3].km, "nach Urlaub weniger vorsichtig als nach Krankheit");
});

test("Plan: Abhaken – gelaufene Einheiten mit Prozent, getauschter Tag, verpasst, selbst abgehakt", () => {
  const hr = hrPace(runs("2026-11-18"), "2026-11-18", Z);
  const p = buildPlan(goal({ hardDay: 1 }), { vdot: 55, weekKm: 40, longKm: 16, hr });
  const w = p.weeks[1].sessions; // Woche ab 23.11.
  const easy = w.find((s) => s.type === "easy")!, iv = w.find((s) => s.type === "interval")!, long = w.find((s) => s.type === "long")!;
  const lap = (sec: number, pace: number, hrv: number) => ({ s: sec, v: 1000 / pace, m: (sec / pace) * 1000, hr: hrv });
  const reps = Array.from({ length: iv.reps! }, () => lap(180, iv.pace!, 175));
  const run = [
    // locker wie geplant, Puls in Zone 2
    { id: "a", date: easy.date, km: easy.km, min: easy.km * 5.5, laps: [lap(easy.km * 330, 330, 140)] },
    // Intervalle: alle Wiederholungen im Tempo, einen Tag später (getauscht)
    { id: "b", date: "2026-11-25", km: iv.km, min: 50, laps: [lap(900, 330, 140), ...reps, lap(600, 360, 130)] },
  ];
  // langer Lauf: 3 km kürzer und die Hälfte über Zone 2 – gleicher Tag
  run.push({ id: "c", date: long.date, km: long.km - 3, min: 80, laps: [lap(2400, 320, 140), lap(2400, 300, 160)] });
  checkOff(p, run, "2026-11-30", [w.find((s) => s.type === "easy" && s !== easy)!.date]);
  assert.equal(easy.done!.pct, 100);
  assert.equal(iv.done!.id, "b");
  assert.equal(iv.done!.pct, 100);
  assert.match(iv.done!.why, /Tempo getroffen/);
  assert.ok(long.done!.pct! < 80 && long.done!.pct! > 40, "lang " + long.done!.pct);
  assert.match(long.done!.why, /km kürzer.*über dem lockeren Bereich/);
  assert.ok(w.some((s) => s.done?.manual), "selbst abgehakt");
  assert.ok(w.some((s) => s.missed), "Rest verpasst");
  // langsamere Intervalle kosten Prozente
  const p2 = buildPlan(goal({ hardDay: 1 }), { vdot: 55, weekKm: 40, longKm: 16, hr });
  const iv2 = p2.weeks[1].sessions.find((s) => s.type === "interval")!;
  checkOff(p2, [{ id: "x", date: iv2.date, km: iv2.km, min: 50, laps: Array.from({ length: iv2.reps! - 1 }, () => lap(180, iv2.pace! * 1.1, 175)) }], "2026-11-30");
  assert.ok(iv2.done!.pct! < 70, "zu langsam und eine zu wenig: " + iv2.done!.pct);
  // Zukunft bleibt offen
  assert.ok(p.weeks[3].sessions.every((s) => !s.done && !s.missed));
});
