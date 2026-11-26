// Tests für Google Health (Fitbit, Pixel Watch). Nur ausgedachte Antworten im Format der Google Health API v4.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  civil, localAt, extractBody, extractDaily, extractSleep, extractSteps, googleType, mergeGoogle, normalizeExercise, sameExercise, seconds, ymd,
} from "../src/google/extract.ts";
import { pickDaily, priority } from "../src/quellen.ts";

const D = (s: string) => ({ year: +s.slice(0, 4), month: +s.slice(5, 7), day: +s.slice(8, 10) });
const C = (s: string) => ({ date: D(s), time: { hours: +s.slice(11, 13), minutes: +s.slice(14, 16) } });
const sleepPoint = (id: string, start: string, end: string, extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  name: `users/me/dataTypes/sleep/dataPoints/${id}`,
  sleep: {
    interval: { startTime: "x", endTime: "y", civilStartTime: C(start), civilEndTime: C(end) },
    type: "STAGES",
    metadata: { mainSleep: true, nap: false, stagesStatus: "SUCCEEDED", ...meta },
    summary: {
      minutesAsleep: "420", minutesAwake: "35", minutesInSleepPeriod: "455",
      stagesSummary: [{ type: "DEEP", minutes: "84", count: "4" }, { type: "REM", minutes: "96", count: "5" }, { type: "LIGHT", minutes: "240", count: "20" }],
    },
    ...extra,
  },
});

test("Google: Datum und Ortszeit aus den civil-Feldern, Dauern in Sekunden", () => {
  assert.equal(ymd({ year: 2026, month: 3, day: 7 }), "2026-03-07");
  assert.equal(civil({ date: { year: 2026, month: 11, day: 9 }, time: { hours: 23, minutes: 5 } }), "2026-11-09T23:05");
  assert.equal(civil({ date: { year: 2026, month: 11, day: 9 } }), "2026-11-09T00:00");
  assert.equal(seconds("3540.5s"), 3540.5);
  assert.equal(seconds("kaputt"), null);
});

test("Google: Schlaf zählt zum Aufwachtag, Hauptschlaf vor Nickerchen, Phasen nur mit Phasen-Erkennung", () => {
  const rows = extractSleep({
    dataPoints: [
      sleepPoint("a", "2026-11-09T22:50", "2026-11-10T06:45"),
      sleepPoint("b", "2026-11-10T14:00", "2026-11-10T14:40", {}, { nap: true, mainSleep: false }),
      // Ohne Phasen (z. B. Gerät zu locker): Dauer ja, Tief/REM nein
      sleepPoint("c", "2026-11-10T23:30", "2026-11-11T07:00", { type: "CLASSIC" }, { stagesStatus: "REJECTED_COVERAGE" }),
    ],
  });
  const m = Object.fromEntries(rows.map((r) => [r.day + " " + r.metric, r.value]));
  assert.deepEqual(m, {
    "2026-11-10 slp": 7, "2026-11-10 deep": 1.4, "2026-11-10 rem": 1.6, "2026-11-10 awake": 35, "2026-11-10 bed": 22.83, "2026-11-10 wake": 6.75,
    "2026-11-11 slp": 7, "2026-11-11 awake": 35, "2026-11-11 bed": 23.5, "2026-11-11 wake": 7,
  });
});

test("Google: Tageswerte (HRV, Ruhepuls, SpO2, Atemfrequenz, Hauttemperatur)", () => {
  const p = (field: string, day: string, v: Record<string, unknown>) => ({ [field]: { date: D(day), ...v } });
  assert.deepEqual(extractDaily("daily-heart-rate-variability", { dataPoints: [p("dailyHeartRateVariability", "2026-11-10", { averageHeartRateVariabilityMilliseconds: 41.6, entropy: 2.1 })] }),
    [{ day: "2026-11-10", metric: "hrv", value: 42 }]);
  assert.deepEqual(extractDaily("daily-resting-heart-rate", { dataPoints: [p("dailyRestingHeartRate", "2026-11-10", { beatsPerMinute: "56" })] }),
    [{ day: "2026-11-10", metric: "rhr", value: 56 }]);
  assert.deepEqual(extractDaily("daily-oxygen-saturation", { dataPoints: [p("dailyOxygenSaturation", "2026-11-10", { averagePercentage: 95.83 })] }),
    [{ day: "2026-11-10", metric: "spo2", value: 95.8 }]);
  assert.deepEqual(extractDaily("daily-respiratory-rate", { dataPoints: [p("dailyRespiratoryRate", "2026-11-10", { breathsPerMinute: 14.26 })] }),
    [{ day: "2026-11-10", metric: "resp", value: 14.3 }]);
  assert.deepEqual(extractDaily("daily-sleep-temperature-derivations", { dataPoints: [p("dailySleepTemperatureDerivations", "2026-11-10", { nightlyTemperatureCelsius: 33.94 })] }),
    [{ day: "2026-11-10", metric: "skinT", value: 33.9 }]);
  // Unbekannter Typ, fehlender Wert, kaputte Antwort: nichts
  assert.deepEqual(extractDaily("unbekannt", { dataPoints: [{}] }), []);
  assert.deepEqual(extractDaily("daily-resting-heart-rate", { dataPoints: [p("dailyRestingHeartRate", "2026-11-10", {})] }), []);
  assert.deepEqual(extractDaily("daily-resting-heart-rate", null), []);
});

test("Google: Gewicht und Körperfett, pro Tag die letzte Messung; Schritte aus dailyRollUp", () => {
  const rows = extractBody({
    dataPoints: [
      { weight: { sampleTime: { civilTime: C("2026-11-10T07:10") }, weightGrams: 74210 } },
      { weight: { sampleTime: { civilTime: C("2026-11-10T21:00") }, weightGrams: 75000 } },
      { bodyFat: { sampleTime: { civilTime: C("2026-11-10T07:10") }, percentage: 17.25 } },
    ],
  });
  assert.deepEqual(rows.sort((a, b) => a.metric.localeCompare(b.metric)), [
    { day: "2026-11-10", metric: "fat", value: 17.3 }, { day: "2026-11-10", metric: "kg", value: 75 },
  ]);
  assert.deepEqual(extractSteps({ rollupDataPoints: [{ civilStartTime: C("2026-11-10T00:00"), civilEndTime: C("2026-11-11T00:00"), steps: { countSum: "10342" } }] }),
    [{ day: "2026-11-10", metric: "steps", value: 10342 }]);
});

test("Google: Training → Einheit mit g-ID, Ortszeit, Fitbit-Zonen eigenes Feld, ohne Trainingswirkung", () => {
  const a = normalizeExercise({
    name: "users/me/dataTypes/exercise/dataPoints/ex-1234",
    exercise: {
      interval: { startTime: "2026-11-10T16:02:00Z", endTime: "2026-11-10T16:52:00Z", civilStartTime: C("2026-11-10T17:02"), civilEndTime: C("2026-11-10T17:52") },
      exerciseType: "RUNNING", displayName: "Laufen", activeDuration: "2880s",
      metricsSummary: {
        distanceMillimeters: 9012000, caloriesKcal: 612.4, averageHeartRateBeatsPerMinute: "151", elevationGainMillimeters: 41600,
        steps: "8100", activeZoneMinutes: "62", runVo2Max: 47.3,
        heartRateZoneDurations: { lightTime: "300s", moderateTime: "1200s", vigorousTime: "1320s", peakTime: "60s" },
      },
    },
  })!;
  assert.deepEqual([a.id, a.src, a.date, a.start, a.type, a.km, a.min, a.minTotal, a.hr, a.elev, a.kcal, a.azm, a.vo2],
    ["gex-1234", "google", "2026-11-10", "17:02", "running", 9.01, 48, 50, 151, 42, 612, 62, 47.3]);
  assert.deepEqual(a.gz, [5, 20, 22, 1]);
  assert.equal(a.z, undefined);
  assert.equal(a.te, null);
  assert.equal(googleType("YOGA_VINYASA"), "yoga");
  assert.equal(googleType("PADEL"), "padel");
  assert.equal(googleType(undefined), "other");
  assert.equal(normalizeExercise({ exercise: {} }), null);
});

test("Google: gleiche Einheit wie die Garmin-Uhr wird zusammengeführt, die Uhr bleibt", () => {
  const garmin = { id: "1", src: "garmin", date: "2026-11-10", start: "17:01", type: "running", km: 9.05, min: 49.5 };
  const g = { id: "gx", gid: "x", src: "google", date: "2026-11-10", start: "17:02", type: "running", min: 48, minTotal: 50, kcal: 612, azm: 62, hr: 151 };
  const yoga = { id: "gy", gid: "y", src: "google", date: "2026-11-10", start: "07:00", type: "yoga", min: 30 };
  const out = mergeGoogle([garmin, g, yoga]);
  assert.deepEqual(out.map((a) => a.id), ["1", "gy"]);
  assert.deepEqual(out[0].google, { gid: "x", kcal: 612, azm: 62, hr: 151 });
  assert.equal(sameExercise({ ...garmin, type: "road_biking" }, g), false);
  assert.equal(sameExercise({ ...garmin, start: "17:10" }, g), false);
});

test("Quellen: Fitbit-Nachtwerte nach WHOOP und Garmin, auf Wunsch zuerst; nur Fitbit = Fitbit", () => {
  assert.deepEqual(priority("hrv").slice(0, 3), ["whoop", "garmin", "google"]);
  assert.deepEqual(priority("slp", { night: "google" }).slice(0, 3), ["google", "whoop", "garmin"]);
  assert.deepEqual(priority("steps").slice(0, 4), ["garmin", "withings", "strava", "google"]);
  const R = (day: string, metric: string, source: string, value: number) => ({ day, metric, source, value });
  const d = pickDaily([R("2026-11-10", "hrv", "google", 42), R("2026-11-10", "slp", "google", 7), R("2026-11-10", "slp", "garmin", 7.4)]);
  assert.deepEqual(d["2026-11-10"], { d: "2026-11-10", hrv: 42, hrvSrc: "google", slp: 7.4 });
  const g = pickDaily([R("2026-11-10", "slp", "google", 7), R("2026-11-10", "slp", "garmin", 7.4)], { night: "google" });
  assert.equal(g["2026-11-10"].slp, 7);
});

test("Google: ohne civil-Felder Ortszeit aus Weltzeit + Zeitunterschied (Feedback #8)", () => {
  assert.equal(localAt(undefined, "2026-11-24T22:40:00Z", "3600s"), "2026-11-24T23:40");
  assert.equal(localAt(undefined, "2026-11-24T22:40:00Z", undefined), null);
  const sleep = { dataPoints: [{ name: "users/me/dataTypes/sleep/dataPoints/1", sleep: {
    interval: { startTime: "2026-11-24T22:40:00Z", startUtcOffset: "3600s", endTime: "2026-11-25T05:58:00Z", endUtcOffset: "3600s" },
    metadata: { mainSleep: true }, summary: { minutesAsleep: "402", stagesSummary: [{ type: "DEEP", minutes: "70" }] } } }] };
  const rows = extractSleep(sleep);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.day === "2026-11-25"));
  assert.ok(rows.some((r) => r.metric === "slp"));
  const ex = normalizeExercise({ name: "users/me/dataTypes/exercise/dataPoints/77", exercise: {
    exerciseType: "RUNNING", interval: { startTime: "2026-11-25T16:02:00Z", startUtcOffset: "3600s", endTime: "2026-11-25T16:52:00Z", endUtcOffset: "3600s" } } });
  assert.equal(ex?.date, "2026-11-25");
  assert.equal(ex?.start, "17:02");
});
