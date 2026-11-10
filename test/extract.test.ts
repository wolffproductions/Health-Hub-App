// Tests mit synthetischen Garmin-Antworten im Format der Personal API (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockHours,
  extractDailySummaries,
  extractHrv,
  extractSleep,
  extractWeight,
  normalizeActivity,
  toList,
} from "../src/garmin/extract.ts";

const byMetric = (rows: Array<{ metric: string; value: number }>) => Object.fromEntries(rows.map((r) => [r.metric, r.value]));

test("dailysummaries im Personal-API-Format ({data:[…]}, verschachtelt)", () => {
  const rows = extractDailySummaries({
    data: [{
      calendarDate: "2026-11-01",
      heartRate: { restingValue: 47 },
      stress: { avgLevel: 24 },
      bodyBattery: { maxValue: 91, minValue: 12 },
      movement: { steps: { value: 10432 } },
      intensityMinutes: { vigorous: 38, moderate: 15 },
    }],
  });
  assert.deepEqual(byMetric(rows), { rhr: 47, stress: 24, bbMax: 91, bbMin: 12, steps: 10432, vig: 38, mod: 15 });
});

test("dailysummaries: altes flaches Format und Stress -1 wird verworfen", () => {
  const m = byMetric(extractDailySummaries([{ calendarDate: "2026-11-02", restingHeartRate: 50, averageStressLevel: -1, totalSteps: 800 }]));
  assert.equal(m.rhr, 50);
  assert.equal(m.steps, 800);
  assert.equal(m.stress, undefined);
});

test("Schlaf: Stunden, Score, Einschlafzeit nach Mitternacht > 24", () => {
  const bed = Date.UTC(2026, 10, 3, 0, 30); // 00:30 lokal
  const wake = Date.UTC(2026, 10, 3, 7, 15);
  const m = byMetric(extractSleep([{
    calendarDate: "2026-11-03", sleepTimeSeconds: 24300, deepSleepSeconds: 5400, remSleepSeconds: 6300, awakeSleepSeconds: 900,
    sleepScores: { overall: { value: 82 } }, avgHeartRate: 49, sleepStartTimestampLocal: bed, sleepEndTimestampLocal: wake,
  }, { calendarDate: "2026-11-04", sleepTimeSeconds: 0 }]));
  assert.equal(m.slp, 6.75);
  assert.equal(m.deep, 1.5);
  assert.equal(m.awake, 15);
  assert.equal(m.score, 82);
  assert.equal(m.bed, 24.5);
  assert.equal(m.wake, 7.25);
});

test("HRV aus hrvSummaries mit Normalbereich", () => {
  const m = byMetric(extractHrv({ hrvSummaries: [{ calendarDate: "2026-11-04", lastNightAvg: 62, weeklyAvg: 58, baseline: { balancedLow: 52, balancedUpper: 70 } }] }));
  assert.deepEqual(m, { hrv: 62, hrvWk: 58, hrvLo: 52, hrvHi: 70 });
});

test("Gewicht: Gramm -> kg, letzte Messung des Tages gewinnt", () => {
  const rows = extractWeight({ dateWeightList: [{ calendarDate: "2026-11-05", weight: 74100 }, { calendarDate: "2026-11-05", weight: 73800, bodyFat: 14.2 }] });
  assert.deepEqual(byMetric(rows), { kg: 73.8, fat: 14.2 });
});

test("Training normalisieren", () => {
  const a = normalizeActivity({
    activityId: 123, activityName: "Morgenrunde", startTimeLocal: "2026-11-06 07:12:00", activityType: { typeKey: "running" },
    distance: 10230, duration: 3010, averageHR: 148, averageSpeed: 3.398, activityTrainingLoad: 92.4,
    trainingEffectLabel: "AEROBIC_BASE", hrTimeInZone_2: 1200.4, fastestSplit_5000: 1420.2, vO2MaxValue: 51,
  })!;
  assert.equal(a.id, "123");
  assert.equal(a.date, "2026-11-06");
  assert.equal(a.start, "07:12");
  assert.equal(a.km, 10.23);
  assert.equal(a.min, 50.2);
  assert.deepEqual(a.z, [0, 1200, 0, 0, 0]);
  assert.equal(a.f5k, 1420);
  assert.equal(a.vo2, 51);
  assert.equal(normalizeActivity({ activityId: 1, startTimeLocal: "2026-11-06 07:12:00" })!.vo2, null);
  assert.equal(normalizeActivity({ activityName: "ohne ID" }), null);
});

test("Hilfsfunktionen", () => {
  assert.equal(toList({ data: [{ a: 1 }] }).length, 1);
  assert.equal(clockHours(null, true), null);
});

test("Schlaf: Puls im Schlaf aus averageSpO2HRSleep, wenn avgHeartRate leer ist", () => {
  const m = byMetric(extractSleep([{ calendarDate: "2026-11-07", sleepTimeSeconds: 27000, avgHeartRate: null, averageSpO2HRSleep: 51, averageSpO2Value: 95, lowestSpO2Value: 88 }]));
  assert.equal(m.shr, 51);
  assert.equal(m.spo2, 95);
  assert.equal(m.spo2Lo, 88);
});

test("dailysummaries: Stressstufen und Body Battery geladen/verbraucht (verschachtelt und flach)", () => {
  const a = byMetric(extractDailySummaries({ data: [{ calendarDate: "2026-11-08", stress: { avgLevel: 30, maxLevel: 88, restDuration: 18000, lowDuration: 9000, mediumDuration: 3600, highDuration: 1200 }, bodyBattery: { chargedValue: 55, drainedValue: 61 } }] }));
  assert.deepEqual([a.stressMax, a.stRest, a.stLow, a.stMed, a.stHi, a.bbCharged, a.bbDrained], [88, 300, 150, 60, 20, 55, 61]);
  const b = byMetric(extractDailySummaries([{ calendarDate: "2026-11-09", averageStressLevel: 25, maxStressLevel: -1, highStressDuration: 600, bodyBatteryChargedValue: 40 }]));
  assert.equal(b.stHi, 10);
  assert.equal(b.bbCharged, 40);
  assert.equal(b.stressMax, undefined);
});
