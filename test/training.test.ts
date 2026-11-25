// Tests für den Trainingsplan von Claude (#20), synthetische Einheiten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSession, EMPTY_PLAN, mergeSessions, moveSession, paceSec, sessionLine, type TSession } from "../src/training.ts";

const s = (date: string, type: TSession["type"] = "easy", title = "Locker"): TSession => ({ date, type, title, detail: "" });

test("Training: Einheiten von Claude werden geprüft", () => {
  const ok = cleanSession({ date: "2026-11-24", type: "interval", title: "5 × 1000 m", detail: "x", km: 11.04, reps: 5, pace_per_km: "3:28", hr_max: 185 });
  assert.equal(typeof ok, "object");
  assert.deepEqual({ ...(ok as TSession) }, { date: "2026-11-24", type: "interval", title: "5 × 1000 m", detail: "x", km: 11, reps: 5, pace: 208, hrMax: 185 });
  // reps_min nur, wenn kleiner als reps
  assert.equal((cleanSession({ date: "2026-11-24", type: "interval", title: "x", reps: 18, reps_min: 16 }) as TSession).repsMin, 16);
  assert.equal((cleanSession({ date: "2026-11-24", type: "interval", title: "x", reps: 18, reps_min: 20 }) as TSession).repsMin, undefined);
  assert.equal(typeof cleanSession({ date: "24.11.", type: "easy", title: "x" }), "string");
  assert.equal(typeof cleanSession({ date: "2026-11-24", type: "sprint", title: "x" }), "string");
  assert.equal(typeof cleanSession({ date: "2026-11-24", type: "easy", title: "" }), "string");
  assert.equal(paceSec("4:50"), 290);
  assert.equal(paceSec("99"), null);
});

test("Training: neue Einheiten ersetzen den Rest des Plans, Verlauf bleibt", () => {
  const p1 = mergeSessions(EMPTY_PLAN, [s("2026-11-23"), s("2026-11-25"), s("2026-11-30")]);
  const p2 = mergeSessions(p1, [s("2026-11-26", "tempo", "Schwelle")]);
  assert.deepEqual(p2.sessions.map((x) => x.date), ["2026-11-23", "2026-11-25", "2026-11-26"]);
  // nur eine Woche ersetzen, danach bleibt alles
  const p3 = mergeSessions(p1, [s("2026-11-24")], "2026-11-23", "2026-11-29");
  assert.deepEqual(p3.sessions.map((x) => x.date), ["2026-11-24", "2026-11-30"]);
  // Zeitraum leeren
  assert.deepEqual(mergeSessions(p1, [], "2026-11-24", "2026-11-26").sessions.map((x) => x.date), ["2026-11-23", "2026-11-30"]);
});

test("Training: verschieben in der Woche, belegter Tag wird getauscht, Wettkampf bleibt", () => {
  const p = mergeSessions(EMPTY_PLAN, [s("2026-11-24", "interval", "Intervalle"), s("2026-11-26"), s("2026-11-29", "race", "Wettkampf")]);
  const a = moveSession(p, "2026-11-24", 0, "2026-11-25");
  assert.ok(typeof a !== "string");
  assert.equal(a.sessions.find((x) => x.type === "interval")!.date, "2026-11-25");
  const b = moveSession(p, "2026-11-24", 0, "2026-11-26") as typeof p;
  assert.equal(b.sessions.find((x) => x.type === "interval")!.date, "2026-11-26");
  assert.equal(b.sessions.find((x) => x.title === "Locker")!.date, "2026-11-24");
  assert.equal(typeof moveSession(p, "2026-11-24", 0, "2026-12-01"), "string", "nicht in eine andere Woche");
  assert.equal(typeof moveSession(p, "2026-11-29", 0, "2026-11-28"), "string", "Wettkampf fest");
  assert.equal(typeof moveSession(p, "2026-11-26", 0, "2026-11-29"), "string", "nicht auf den Wettkampftag");
});

test("Training: kurze Zeile für Push und Heute", () => {
  assert.equal(sessionLine({ ...s("2026-11-24"), km: 10, pace: 300, hrMax: 150 }), "Locker · 10 km · 5:00 /km · unter 150 bpm");
  assert.equal(sessionLine({ ...s("2026-11-24", "strength", "Kraft"), min: 30 }), "Kraft · 30 min");
});
