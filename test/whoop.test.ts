// Tests für WHOOP (#119). Nur ausgedachte Antworten im Format der WHOOP-API v2, keine echten Daten.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  cycleDay, extractCycles, extractRecoveries, extractSleeps, localTime, mergeWhoop, normalizeWorkout, sameWorkout, webhookSignature, whoopType,
} from "../src/whoop/extract.ts";
import { mergeDuplicates } from "../src/strava/extract.ts";

const H = 3600000;
const sleep = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, cycle_id: 1000 + Number(id.slice(-1)), user_id: 1, start, end, timezone_offset: "+01:00", nap: false, score_state: "SCORED",
  score: {
    stage_summary: { total_in_bed_time_milli: 8 * H, total_awake_time_milli: 0.5 * H, total_light_sleep_time_milli: 3.5 * H, total_slow_wave_sleep_time_milli: 1.5 * H, total_rem_sleep_time_milli: 2 * H },
    respiratory_rate: 15.234, sleep_performance_percentage: 88, sleep_efficiency_percentage: 93,
  },
  ...extra,
});
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

test("WHOOP: Ortszeit über den Versatz, sonst über die Zeitzone", () => {
  assert.equal(localTime("2026-11-09T23:30:00.000Z", "+01:00"), "2026-11-10T00:30");
  assert.equal(localTime("2026-11-09T23:30:00.000Z", "-05:00"), "2026-11-09T18:30");
  assert.equal(localTime("2026-07-01T22:30:00Z", null, "Europe/Berlin"), "2026-07-02T00:30");
  assert.equal(localTime("kaputt", "+01:00"), null);
});

test("WHOOP: Schlaf zählt zum Aufwachtag, Nickerchen nicht, längster Schlaf gewinnt", () => {
  const { rows, dayOf } = extractSleeps({
    records: [
      // 22:45 bis 06:50 Ortszeit → gehört zum 10.11.
      sleep(ID(1), "2026-11-09T21:45:00Z", "2026-11-10T05:50:00Z"),
      // Nickerchen am Nachmittag desselben Tages: nicht in die Nacht einrechnen
      sleep(ID(2), "2026-11-10T13:00:00Z", "2026-11-10T13:40:00Z", { nap: true }),
      // Nicht bewertet: ignorieren
      sleep(ID(3), "2026-11-10T21:00:00Z", "2026-11-11T05:00:00Z", { score_state: "PENDING_SCORE" }),
    ],
  });
  const m = Object.fromEntries(rows.map((r) => [r.day + " " + r.metric, r.value]));
  assert.deepEqual(m, {
    "2026-11-10 slp": 7, "2026-11-10 deep": 1.5, "2026-11-10 rem": 2, "2026-11-10 awake": 30, "2026-11-10 score": 88,
    "2026-11-10 resp": 15.2, "2026-11-10 bed": 22.75, "2026-11-10 wake": 6.83,
  });
  assert.deepEqual(dayOf, { [ID(1)]: "2026-11-10" });
});

test("WHOOP: Recovery über die Schlaf-ID am Aufwachtag, sonst am Tag der Berechnung", () => {
  const rows = extractRecoveries({
    records: [
      { cycle_id: 1, sleep_id: ID(1), created_at: "2026-11-10T06:10:00Z", score_state: "SCORED",
        score: { user_calibrating: false, recovery_score: 71, resting_heart_rate: 48, hrv_rmssd_milli: 64.6, spo2_percentage: 96.04, skin_temp_celsius: 33.71 } },
      { cycle_id: 2, sleep_id: ID(9), created_at: "2026-11-11T05:40:00Z", score_state: "SCORED",
        score: { recovery_score: 30, resting_heart_rate: 53, hrv_rmssd_milli: 41 } },
      { cycle_id: 3, sleep_id: ID(8), created_at: "2026-11-12T05:40:00Z", score_state: "UNSCORABLE" },
    ],
  }, { [ID(1)]: "2026-11-10" });
  const m = Object.fromEntries(rows.map((r) => [r.day + " " + r.metric, r.value]));
  assert.deepEqual(m, {
    "2026-11-10 rec": 71, "2026-11-10 hrv": 65, "2026-11-10 rhr": 48, "2026-11-10 spo2": 96, "2026-11-10 skinT": 33.7,
    "2026-11-11 rec": 30, "2026-11-11 hrv": 41, "2026-11-11 rhr": 53,
  });
});

test("WHOOP: Cycle (Einschlafen bis Einschlafen) zählt zum Tag nach der Nacht", () => {
  assert.equal(cycleDay("2026-11-09T22:30:00Z", "+01:00"), "2026-11-10"); // 23:30 eingeschlafen
  assert.equal(cycleDay("2026-11-10T00:30:00Z", "+01:00"), "2026-11-10"); // 01:30 eingeschlafen
  const rows = extractCycles({
    records: [
      { id: 1, start: "2026-11-09T22:30:00Z", end: null, timezone_offset: "+01:00", score_state: "SCORED", score: { strain: 12.345, kilojoule: 10460, average_heart_rate: 70, max_heart_rate: 171 } },
      { id: 2, start: "2026-11-08T22:00:00Z", end: "2026-11-09T22:30:00Z", timezone_offset: "+01:00", score_state: "PENDING_SCORE" },
    ],
  });
  assert.deepEqual(rows, [{ day: "2026-11-10", metric: "strain", value: 12.3 }, { day: "2026-11-10", metric: "kcal", value: 2500 }]);
});

test("WHOOP: Workout → Einheit mit w-ID, Ortszeit, Strain und Zonen; ohne Route und Trainingseffekt", () => {
  const a = normalizeWorkout({
    id: ID(5), start: "2026-11-10T16:02:00Z", end: "2026-11-10T16:50:30Z", timezone_offset: "+01:00", sport_name: "running", score_state: "SCORED",
    score: { strain: 11.84, average_heart_rate: 151, max_heart_rate: 176, kilojoule: 2928.8, distance_meter: 9012, altitude_gain_meter: 41.6,
      zone_durations: { zone_zero_milli: 0, zone_one_milli: 60000, zone_two_milli: 900000, zone_three_milli: 1500000, zone_four_milli: 400000, zone_five_milli: 50000 } },
  })!;
  assert.equal(a.id, "w" + ID(5));
  assert.equal(a.src, "whoop");
  assert.deepEqual([a.date, a.start, a.type, a.km, a.min, a.hr, a.elev, a.kcal, a.strain], ["2026-11-10", "17:02", "running", 9.01, 48.5, 151, 42, 700, 11.8]);
  assert.deepEqual(a.z, [60, 900, 1500, 400, 50]);
  assert.equal(a.te, null);
  assert.equal(normalizeWorkout({ id: 5 }), null);
  assert.equal(whoopType("Functional Fitness"), "fitness_equipment");
  assert.equal(whoopType("Ice Bath"), "ice_bath");
});

test("WHOOP: gleiche Einheit wie die Uhr wird zusammengeführt, die Uhr bleibt", () => {
  const garmin = { id: "1", src: "garmin", date: "2026-11-10", start: "17:01", type: "running", km: 9.05, min: 47.9, hr: 150 };
  const strava = { id: "s7", src: "strava", date: "2026-11-10", start: "17:01", type: "running", km: 9.06, min: 47.9, re: 80 };
  const w = { id: "w" + ID(5), wid: ID(5), src: "whoop", date: "2026-11-10", start: "17:02", type: "running", km: null, min: 48.5, hr: 151, maxHr: 176, kcal: 700, strain: 11.8 };
  const yoga = { id: "w" + ID(6), wid: ID(6), src: "whoop", date: "2026-11-10", start: "07:00", type: "yoga", min: 30, strain: 4.1 };
  const out = mergeWhoop(mergeDuplicates([garmin, strava, w, yoga]));
  assert.deepEqual(out.map((a) => a.id), ["1", "w" + ID(6)]);
  assert.equal(out[0].strava.re, 80);
  assert.deepEqual(out[0].whoop, { wid: ID(5), strain: 11.8, kcal: 700, hr: 151, maxHr: 176 });
  // Andere Sportart oder deutlich andere Dauer: nicht dieselbe Einheit
  assert.equal(sameWorkout({ ...garmin, type: "road_biking" }, w), false);
  assert.equal(sameWorkout({ ...garmin, min: 90 }, w), false);
  assert.equal(sameWorkout({ ...garmin, start: "17:10" }, w), false);
});

test("WHOOP: Webhook-Signatur = Base64(HMAC-SHA256(Secret, Zeitstempel + Rohtext))", async () => {
  const body = JSON.stringify({ user_id: 1, id: ID(1), type: "sleep.updated", trace_id: "t" });
  const want = createHmac("sha256", "geheim").update("1731234567890" + body).digest("base64");
  assert.equal(await webhookSignature("geheim", "1731234567890", body), want);
});

test("WHOOP: leere oder kaputte Antworten ergeben nichts", () => {
  assert.deepEqual(extractSleeps(null).rows, []);
  assert.deepEqual(extractRecoveries({ records: [null, 1, "x"] }), []);
  assert.deepEqual(extractCycles({ records: [{ score_state: "SCORED", score: {} }] }), []);
});
