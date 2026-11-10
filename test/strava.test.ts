// Tests für die Strava-Auswertung mit synthetischen Antworten im Format der Strava-API (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePolyline, mergeDuplicates, normalizeStrava, sameUnit, stravaType } from "../src/strava/extract.ts";

const run = {
  id: 1234567890, name: "Abendlauf", sport_type: "Run", start_date: "2026-11-07T17:02:10Z", start_date_local: "2026-11-07T18:02:10Z",
  distance: 10020.4, moving_time: 2950, elapsed_time: 3100, total_elevation_gain: 48.2, average_speed: 3.396, max_speed: 5.1,
  average_cadence: 86.4, average_heartrate: 151.3, max_heartrate: 172, suffer_score: 88, pr_count: 2, achievement_count: 5,
  kudos_count: 7, comment_count: 1, total_photo_count: 0, trainer: false, commute: false, workout_type: 0, gear_id: "g1",
  map: { summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
};

test("Strava-Lauf normalisieren: Kadenz in Schritten, Pace-Grundlage, Extras", () => {
  const n = normalizeStrava(run)!;
  assert.equal(n.id, "s1234567890");
  assert.equal(n.src, "strava");
  assert.equal(n.date, "2026-11-07");
  assert.equal(n.start, "18:02");
  assert.equal(n.type, "running");
  assert.equal(n.km, 10.02);
  assert.equal(n.min, 49.2);
  assert.equal(n.cad, 173);
  assert.equal(n.re, 88);
  assert.equal(n.prs, 2);
  assert.equal(normalizeStrava({ name: "ohne ID" }), null);
});

test("Sportarten und Polyline", () => {
  assert.equal(stravaType("VirtualRide"), "virtual_ride");
  assert.equal(stravaType("StandUpPaddling"), "stand_up_paddling");
  // Beispiel aus Googles Doku zum Polyline-Format
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual(decodePolyline(""), []);
});

test("Doppelte Einheit Garmin + Strava: Garmin bleibt, Strava-Extras hängen dran", () => {
  const g = { id: "987", src: "garmin", date: "2026-11-07", start: "18:01", type: "running", km: 10.05, name: "" };
  const s = normalizeStrava(run)!;
  const solo = normalizeStrava({ ...run, id: 55, start_date_local: "2026-11-08T07:00:00Z", sport_type: "VirtualRide", distance: 30000 })!;
  assert.equal(sameUnit(g, s), true);
  assert.equal(sameUnit({ ...g, start: "18:10" }, s), false);       // Start zu weit auseinander
  assert.equal(sameUnit({ ...g, km: 8 }, s), false);                // Distanz zu verschieden
  assert.equal(sameUnit({ ...g, type: "road_biking" }, s), false);  // andere Sportart
  const out = mergeDuplicates([g, s, solo]);
  assert.equal(out.length, 2);
  const merged = out.find((a) => a.id === "987")!;
  assert.equal(merged.strava.sid, "1234567890");
  assert.equal(merged.strava.kudos, 7);
  assert.equal(merged.name, "Abendlauf"); // Garmin ohne Namen übernimmt den Strava-Titel
  assert.ok(out.find((a) => a.id === "s55"));
});
