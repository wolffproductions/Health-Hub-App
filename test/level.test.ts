// Tests für Level und Punkte (#192), synthetische Daten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLevel, isHard, levelCost, levelFrom, minutesOf, weekOf } from "../src/level.ts";

const run = (date: string, min: number, extra: Record<string, unknown> = {}) => ({ id: date + "-" + min, date, start: "08:00", type: "running", min, ...extra });

test("Level-Kurve: Level 2 kostet 120, jedes weitere 20 mehr", () => {
  assert.equal(levelCost(1), 120);
  assert.equal(levelCost(2), 140);
  assert.deepEqual(levelFrom(0), { level: 1, into: 0, need: 120 });
  assert.deepEqual(levelFrom(119), { level: 1, into: 119, need: 120 });
  assert.deepEqual(levelFrom(120), { level: 2, into: 0, need: 140 });
  assert.deepEqual(levelFrom(120 + 140 + 5), { level: 3, into: 5, need: 160 });
});

test("Bewegungszeit vor Gesamtzeit, Kraft höchstens 60 Minuten", () => {
  assert.equal(minutesOf({ id: "a", date: "2026-12-01", type: "running", min: 50, mov: 45 }), 45);
  assert.equal(minutesOf({ id: "a", date: "2026-12-01", type: "running", min: 50 }), 50);
  assert.equal(minutesOf({ id: "a", date: "2026-12-01", type: "strength_training", min: 120 }), 60);
  assert.equal(minutesOf({ id: "a", date: "2026-12-01", type: "yoga", min: 40 }), 40);
});

test("Hart: Wettkampf, Trainingseffekt ab 3, Puls ab 80 % HFmax", () => {
  assert.equal(isHard({ id: "a", date: "d", race: true }, null), true);
  assert.equal(isHard({ id: "a", date: "d", te: 3.0 }, null), true);
  assert.equal(isHard({ id: "a", date: "d", te: 2.9, hr: 150 }, 200), false);
  assert.equal(isHard({ id: "a", date: "d", hr: 160 }, 200), true);
  assert.equal(isHard({ id: "a", date: "d", hr: 160 }, null), false);
});

test("Nur ab dem Starttag, harte Minuten 1,5-fach", () => {
  const l = computeLevel([run("2026-11-30", 60), run("2026-12-01", 60), run("2026-12-02", 40, { te: 3.5 })], "2026-12-01", "2026-12-02", 190);
  assert.equal(l.xp, 60 + 60);
  assert.equal(l.today, 60);
  assert.equal(l.recent[0].hard, true);
});

test("Tagesgrenze 200 Punkte", () => {
  const l = computeLevel([run("2026-12-01", 120, { te: 4 }), { ...run("2026-12-01", 100), id: "b", start: "18:00" }], "2026-12-01", "2026-12-01", 190);
  assert.equal(l.xp, 200);
  assert.match(l.recent[0].note || "", /Tagesgrenze/);
});

test("Über 15 Stunden in der Woche zählen die Minuten halb", () => {
  // Mo–Sa je 3 h (180 Min., Tagesgrenze greift nicht): 15 h voll, die 6. Einheit ganz halb
  const acts = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"].map((d) => run(d, 180));
  const l = computeLevel(acts, "2026-11-30", "2026-12-06", null);
  const akt = l.recent.filter((e) => e.kind === "akt").reverse();
  assert.deepEqual(akt.map((e) => e.pts), [180, 180, 180, 180, 180, 90]);
  assert.equal(l.xp, 5 * 180 + 90 + 50);
});

test("Wochenbonus ab 3 Trainingstagen, einmal je Woche; Pausen kosten nichts", () => {
  const acts = [run("2026-11-30", 30), run("2026-12-01", 30), run("2026-12-03", 30), run("2026-12-04", 30), run("2026-12-21", 30)];
  const l = computeLevel(acts, "2026-11-30", "2026-12-21", null);
  assert.equal(l.recent.filter((e) => e.kind === "woche").length, 1);
  assert.equal(l.xp, 5 * 30 + 50);
});

test("Ausgeblendete Einheiten und solche ohne Zeit zählen nicht", () => {
  const l = computeLevel([run("2026-12-01", 30, { hidden: true }), run("2026-12-01", 0)], "2026-12-01", "2026-12-01", null);
  assert.equal(l.xp, 0);
  assert.equal(l.level, 1);
});

test("Wochenbeginn ist Montag", () => {
  assert.equal(weekOf("2026-12-06"), "2026-11-30");
  assert.equal(weekOf("2026-11-30"), "2026-11-30");
});
