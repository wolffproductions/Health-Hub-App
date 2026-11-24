// Tests für die Strava-Auswertung mit synthetischen Antworten im Format der Strava-API (keine echten Daten).
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePolyline, isAutoName, mergeDuplicates, normalizeStrava, sameUnit, stravaDetail, stravaType } from "../src/strava/extract.ts";

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

test("Strava-Name statt Garmins Standardname, automatische Strava-Namen nicht (#113)", () => {
  const g = (name: string) => ({ id: "987", src: "garmin", date: "2026-11-07", start: "18:01", type: "running", km: 10.05, name });
  const s = (name: string) => normalizeStrava({ ...run, name })!;
  let m = mergeDuplicates([g("Stadt Laufen"), s("4 × 1200 m an der Donau")])[0];
  assert.equal(m.name, "4 × 1200 m an der Donau");
  assert.equal(m.garminName, "Stadt Laufen");
  for (const auto of ["Abendlauf", "Morgenlauf", "Lauf am Nachmittag", "Morning Run", "Evening Ride", "Nachmittägliche Radfahrt"]) {
    assert.equal(isAutoName(auto), true, auto);
    assert.equal(mergeDuplicates([g("Stadt Laufen"), s(auto)])[0].name, "Stadt Laufen", auto);
  }
  for (const own of ["Abendrunde mit Pablo", "Longrun", "Wettkampf 10 km"]) assert.equal(isAutoName(own), false, own);
});

test("Strava-Detail (#50): Runden, sonst Kilometer-Splits; Segmente und Bestleistungen mit eigenem Rang", () => {
  // synthetische Detailantwort, nur Feldnamen aus der Strava-Doku
  const split = (i: number) => ({ distance: 1000, moving_time: 300 - i, elapsed_time: 300 - i, average_speed: 1000 / (300 - i), average_heartrate: 150 + i });
  const d = stravaDetail({
    laps: [{ distance: 5000, moving_time: 1500, average_speed: 3.33 }],
    splits_metric: [split(0), split(1), split(2), { distance: 20, moving_time: 6 }],
    segment_efforts: [
      { name: "Uferweg", elapsed_time: 245, distance: 1010, pr_rank: 1, kom_rank: null, average_heartrate: 165, segment: { id: 42, average_grade: 0.2 } },
      { name: "Brücke", elapsed_time: 61, distance: 300, pr_rank: null, kom_rank: 7, segment: { id: 43, average_grade: 3.4 } },
      { name: "kaputt" },
    ],
    best_efforts: [{ name: "1k", distance: 1000, elapsed_time: 230, pr_rank: 2 }, { name: "5k", distance: 5000, elapsed_time: 1290, pr_rank: null }],
  });
  assert.equal(d.laps.length, 3, "nur eine eigene Runde → Splits, das Reststück unter 50 m fällt weg");
  assert.equal(d.laps[0].tg, 2);
  assert.equal(d.laps[0].m, 1000);
  assert.equal(d.laps[2].hr, 152);
  assert.deepEqual(d.seg.map((s) => [s.n, s.id, s.pr, s.kom]), [["Uferweg", 42, 1, null], ["Brücke", 43, null, 7]]);
  assert.equal(d.be[0].pr, 2);
  assert.equal(d.be[1].pr, null);
  // mit echten Runden (Runden-Knopf) gewinnen die
  const own = stravaDetail({ laps: [{ distance: 2000, moving_time: 420, average_speed: 4.76 }, { distance: 400, moving_time: 150 }], splits_metric: [split(0), split(1)] });
  assert.deepEqual(own.laps.map((l) => [l.m, l.tg]), [[2000, undefined], [400, undefined]]);
  assert.deepEqual(stravaDetail(null as any), { laps: [], seg: [], be: [] });
});

test("Strava-Detail: Segmente hängen bei doppelten Einheiten an der Garmin-Einheit", () => {
  const g = { id: "1", src: "garmin", date: "2026-11-21", start: "09:57", type: "running", km: 16.4, min: 73.7 };
  const s = { id: "s1", src: "strava", sid: "1", date: "2026-11-21", start: "09:58", type: "running", km: 16.5, min: 73.7, seg: [{ n: "Uferweg", id: 42, m: 1000, s: 240, pr: 1, kom: null, hr: null, g: null }], be: [] };
  const out = mergeDuplicates([g, s]);
  assert.equal(out.length, 1);
  assert.equal(out[0].strava.seg[0].n, "Uferweg");
});
