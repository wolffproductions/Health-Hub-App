// Tests für „Tag exportieren“ (src/export-tag.ts). Nur ausgedachte Daten im Format von Garmin und Google Health.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Call, camelType, dayOf, embedPage, EXCLUDED_SOURCES, GOOGLE_NOT_QUERIED, GOOGLE_PROBES, isLocationKey, isProfileKey, namingMatters, nextDay,
  pageTokenOf, probeFilter, probeJson, rawTouches, rollupBody, runProbe, snakeType, stripPrivate, touchesDay, trimToDay,
} from "../src/export-tag.ts";

const D = (s: string) => ({ year: +s.slice(0, 4), month: +s.slice(5, 7), day: +s.slice(8, 10) });
const C = (s: string) => ({ date: D(s), time: { hours: +s.slice(11, 13), minutes: +s.slice(14, 16) } });

test("Export: Rohdatensätze gehören zum Tag, wenn ihr Zeitraum „von_bis“ ihn enthält", () => {
  assert.equal(rawTouches("2026-11-19_2026-11-25", "2026-11-25"), true);
  assert.equal(rawTouches("2026-11-19_2026-11-25", "2026-11-19"), true);
  assert.equal(rawTouches("2026-11-25_2026-11-25", "2026-11-25"), true);
  assert.equal(rawTouches("2026-11-19_2026-11-25", "2026-11-26"), false);
  assert.equal(rawTouches("2026-11-19_2026-11-25", "2026-11-18"), false);
  // Withings speichert nach Stand und Seite, WHOOP nach Abrufdatum: sagt nichts über den Tag
  assert.equal(rawTouches("1732400000_0", "2026-11-25"), false);
  assert.equal(rawTouches("2026-11-25", "2026-11-25"), false);
});

test("Export: Tag eines Eintrags aus Text oder Googles {year, month, day}", () => {
  assert.equal(dayOf("2026-11-25"), "2026-11-25");
  assert.equal(dayOf("2026-11-25T06:41:00.0"), "2026-11-25");
  assert.equal(dayOf({ year: 2026, month: 3, day: 7 }), "2026-03-07");
  assert.equal(dayOf("Lauf am Morgen"), null);
  assert.equal(dayOf(1764052800000), null);
  // calendarDate hat Vorrang: die Garmin-Tageszusammenfassung vom 24. endet um Mitternacht des 25., gehört aber zum 24.
  const summary = { calendarDate: "2026-11-24", startTimestampLocal: "2026-11-24T00:00:00.0", endTimestampLocal: "2026-11-25T00:00:00.0", totalSteps: 8123 };
  assert.equal(touchesDay(summary, "2026-11-25"), false);
  assert.equal(touchesDay(summary, "2026-11-24"), true);
  assert.equal(touchesDay({ total: 3 }, "2026-11-25"), null);
});

test("Export: Garmin-Rohantwort wird auf die Einträge des Tages gekürzt", () => {
  const hrv = {
    userProfilePk: 1,
    hrvSummaries: [
      { calendarDate: "2026-11-23", weeklyAvg: 50, lastNightAvg: 48 },
      { calendarDate: "2026-11-24", weeklyAvg: 51, lastNightAvg: 55 },
      { calendarDate: "2026-11-25", weeklyAvg: 52, lastNightAvg: 61, readings: [{ readingTimeLocal: "2026-11-25T02:10:00.0", hrvValue: 64 }] },
    ],
  };
  const { value, hits } = trimToDay(hrv, "2026-11-25");
  assert.equal(hits, 1);
  assert.deepEqual(value, { userProfilePk: 1, hrvSummaries: [hrv.hrvSummaries[2]] });
  // Liste ohne Objekte bleibt, wie sie ist
  assert.deepEqual(trimToDay({ values: [[1, 2], [3, 4]] }, "2026-11-25"), { value: { values: [[1, 2], [3, 4]] }, hits: 0 });
});

test("Export: Google-Fenster aus dem Abgleich wird auf den Tag gekürzt, Nächte über Mitternacht bleiben ganz", () => {
  const night = (id: string, start: string, end: string) => ({
    name: "users/me/dataTypes/sleep/dataPoints/" + id,
    sleep: { interval: { civilStartTime: C(start), civilEndTime: C(end) }, stages: [{ type: "DEEP", startTime: { date: D(start.slice(0, 10)) } }] },
  });
  const daily = (d: string, bpm: number) => ({ name: "x", dailyRestingHeartRate: { date: D(d), beatsPerMinute: String(bpm) } });
  const got = {
    sleep: [night("a", "2026-11-23T23:10", "2026-11-24T06:50"), night("b", "2026-11-24T22:40", "2026-11-25T06:30"), night("c", "2026-11-25T23:05", "2026-11-26T07:00")],
    exercise: [{ name: "e1", exercise: { interval: { civilStartTime: C("2026-11-25T17:30"), civilEndTime: C("2026-11-25T18:20") } } }],
    "daily-resting-heart-rate": [daily("2026-11-24", 52), daily("2026-11-25", 50)],
    weight: [],
    steps: { rollupDataPoints: [{ civilStartTime: { date: D("2026-11-24") }, steps: { countSum: "9000" } }, { civilStartTime: { date: D("2026-11-25") }, steps: { countSum: "11000" } }] },
  };
  const { value, hits } = trimToDay(got, "2026-11-25") as { value: typeof got; hits: number };
  assert.deepEqual(value.sleep.map((p) => p.name.slice(-1)), ["b", "c"]);
  assert.equal(value.exercise.length, 1);
  assert.deepEqual(value["daily-resting-heart-rate"].map((p) => p.dailyRestingHeartRate.beatsPerMinute), ["50"]);
  assert.deepEqual(value.weight, []);
  assert.deepEqual(value.steps.rollupDataPoints.map((p) => p.steps.countSum), ["11000"]);
  assert.equal(hits, 5);
  // Fenster „bis“ ausschließlich: enthält zum Folgetag nichts → Datensatz fällt weg (hits 0)
  const { hits: none } = trimToDay({ "daily-resting-heart-rate": [daily("2026-11-24", 52)] }, "2026-11-25");
  assert.equal(none, 0);
});

test("Export: Ortsangaben und Profil (Name, Bild) fliegen raus, alles andere bleibt", () => {
  const garmin = {
    activityId: 1, activityName: "Lauf", startLatitude: 52.5, startLongitude: 13.4, endLatitude: 52.51, endLongitude: 13.41,
    locationName: "Musterstadt", hasPolyline: true, averageHR: 142, elevationGain: 80, platform: "x", flat: 1, longestStreak: 3,
    splits: [{ startLatitude: 1, distance: 1000 }],
    ownerId: 7, ownerDisplayName: "beispiel", ownerFullName: "Erika Beispiel", ownerProfileImageUrlSmall: "https://example.test/a.png",
  };
  assert.deepEqual(stripPrivate(garmin), {
    activityId: 1, activityName: "Lauf", averageHR: 142, elevationGain: 80, platform: "x", flat: 1, longestStreak: 3, splits: [{ distance: 1000 }], ownerId: 7,
  });
  for (const k of ["ownerDisplayName", "ownerFullName", "ownerProfileImageUrlMedium", "profileImageUrl", "avatar", "photos", "fullName", "userName", "email", "emailAddress"]) assert.equal(isProfileKey(k), true, k);
  for (const k of ["ownerId", "userProfilePk", "hasImages", "name", "displayName", "activityName"]) assert.equal(isProfileKey(k), false, k);
  for (const k of ["lat", "lng", "lon", "latitude", "longitude", "start_latlng", "end_latlng", "summary_polyline", "map", "route", "exerciseRoute",
    "geoPolylineDTO", "startLocation", "location", "locations", "start_position_lat", "coordinates", "gpsAccuracy"]) assert.equal(isLocationKey(k), true, k);
  for (const k of ["dataPoints", "calendarDate", "altitude", "platform", "translation", "calories", "mapping"]) assert.equal(isLocationKey(k), false, k);
});

test("Export: Google-Filter je Art über genau einen Tag in Ortszeit", () => {
  const p = (id: string) => GOOGLE_PROBES.find((x) => x.id === id)!;
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(probeFilter(p("list:daily-resting-heart-rate"), "2026-11-25"), 'daily_resting_heart_rate.date >= "2026-11-25" AND daily_resting_heart_rate.date < "2026-11-26"');
  assert.equal(probeFilter(p("list:daily-resting-heart-rate"), "2026-11-25", "c"), 'dailyRestingHeartRate.date >= "2026-11-25" AND dailyRestingHeartRate.date < "2026-11-26"');
  assert.equal(probeFilter(p("list:heart-rate"), "2026-11-25"), 'heart_rate.sample_time.civil_time >= "2026-11-25" AND heart_rate.sample_time.civil_time < "2026-11-26"');
  assert.equal(probeFilter(p("list:steps"), "2026-11-25"), 'steps.interval.civil_start_time >= "2026-11-25" AND steps.interval.civil_start_time < "2026-11-26"');
  assert.equal(probeFilter(p("list:sleep"), "2026-11-25"), 'sleep.interval.civil_end_time >= "2026-11-25" AND sleep.interval.civil_end_time < "2026-11-26"');
  assert.equal(probeFilter(p("list:height"), "2026-11-25"), null);
  assert.equal(probeFilter(p("dailyRollUp:steps"), "2026-11-25"), null);
  assert.deepEqual(rollupBody("2026-11-30"), { range: { start: { date: { year: 2026, month: 11, day: 30 } }, end: { date: { year: 2026, month: 12, day: 1 } } }, windowSizeDays: 1 });
  assert.equal(snakeType("daily-sleep-temperature-derivations"), "daily_sleep_temperature_derivations");
  assert.equal(camelType("daily-sleep-temperature-derivations"), "dailySleepTemperatureDerivations");
  // Zweiter Versuch mit anderer Schreibweise nur, wo sie sich unterscheidet
  assert.equal(namingMatters(p("list:heart-rate")), true);
  assert.equal(namingMatters(p("list:steps")), false);
  assert.equal(namingMatters(p("dailyRollUp:heart-rate")), false);
});

test("Export: Liste der Google-Arten passt ins Anfrage-Limit und lässt Arten ohne Leserecht weg", () => {
  const ids = GOOGLE_PROBES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte Art");
  const skipped = new Set(GOOGLE_NOT_QUERIED.flatMap((g) => g.arten));
  for (const p of GOOGLE_PROBES) {
    assert.equal(p.id, p.method + ":" + p.type);
    assert.equal(skipped.has(p.type), false, p.type);
    // Je Aufruf höchstens 4 Anfragen an Google (Seiten × Schreibweisen) plus Token-Erneuerung, weit unter 50
    assert.ok((p.pages || 1) * (namingMatters(p) ? 2 : 1) <= 4, p.id);
    if (p.method === "list" && p.kind !== "none") assert.ok(probeFilter(p, "2026-11-25"), p.id);
  }
  for (const must of ["list:sleep", "list:exercise", "list:heart-rate", "list:steps", "list:oxygen-saturation", "list:heart-rate-variability", "dailyRollUp:floors", "dailyRollUp:active-zone-minutes"]) {
    assert.ok(ids.includes(must), must);
  }
  assert.deepEqual([...EXCLUDED_SOURCES].sort(), ["strava", "whoop"]);
});

test("Export: nächste Seite aus der Antwort, ohne sie ganz einzulesen", () => {
  assert.equal(pageTokenOf('{"dataPoints":[{"x":1}],"nextPageToken":"abc_123-XY"}'), "abc_123-XY");
  assert.equal(pageTokenOf('{\n  "dataPoints": [],\n  "nextPageToken": "t2"\n}\n'), "t2");
  assert.equal(pageTokenOf('{"dataPoints":[{"x":1}]}'), "");
  assert.equal(pageTokenOf('{"dataPoints":[],"nextPageToken":""}'), "");
});

// ---------- Google live, mit nachgebauten Antworten (kein Netz) ----------
const probe = (id: string) => GOOGLE_PROBES.find((x) => x.id === id)!;
/** Nachgebautes Google: Antworten der Reihe nach, merkt sich die Anfragen */
function fakeGoogle(answers: Array<{ status: number; text: string; retry?: string }>) {
  const seen: Array<{ url: string; method?: string; body?: string; auth?: string }> = [];
  const call: Call = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    const a = answers.shift() ?? { status: 500, text: "keine Antwort mehr" };
    return { status: a.status, text: a.text, retry: a.retry ?? null };
  };
  return { call, seen };
}
const io = (call: Call, first: "s" | "c" = "s") => ({ call, base: "https://example.test/v4", token: "test-token", first });

test("Google live: mehrere Seiten unverändert, höchstens so viele wie erlaubt", async () => {
  const page = (n: number, next: string) => `{"dataPoints":[{"name":"p${n}","heartRate":{"beatsPerMinute":"6${n}"}}]${next ? `,"nextPageToken":"${next}"` : ""}}`;
  const g = fakeGoogle([{ status: 200, text: page(1, "t2") }, { status: 200, text: page(2, "t3") }, { status: 200, text: page(3, "") }]);
  const r = await runProbe(probe("list:heart-rate"), "2026-11-25", io(g.call));
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 2); // pages: 2
  assert.equal(r.more, true);
  assert.equal(g.seen.length, 2);
  assert.match(g.seen[0].url, /^https:\/\/example\.test\/v4\/users\/me\/dataTypes\/heart-rate\/dataPoints\?filter=/);
  assert.match(g.seen[0].url, /pageSize=10000/);
  assert.match(g.seen[1].url, /pageToken=t2/);
  assert.equal(g.seen[0].auth, "Bearer test-token");
  const out = JSON.parse(probeJson(probe("list:heart-rate"), r, "2026-11-26T20:00:00.000Z"));
  assert.equal(out.ok, true);
  assert.equal(out.seiten, 2);
  assert.equal(out.weitereSeiten, true);
  assert.equal(out.benennung, "s");
  assert.deepEqual(out.antworten.map((a: any) => a.dataPoints[0].name), ["p1", "p2"]);
});

test("Google live: falscher Filtername (400) → zweiter Versuch in camelCase, Fehler bleiben je Art", async () => {
  const g = fakeGoogle([{ status: 400, text: '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}' }, { status: 200, text: '{"dataPoints":[]}' }]);
  const r = await runProbe(probe("list:daily-heart-rate-variability"), "2026-11-25", io(g.call));
  assert.equal(r.ok, true);
  assert.equal(r.naming, "c");
  assert.equal(r.versuche.length, 2);
  assert.match(new URL(g.seen[1].url).searchParams.get("filter")!, /dailyHeartRateVariability\.date >= "2026-11-25"/);
  // 403 (z. B. Recht fehlt): kein zweiter Versuch, aber weiter mit den anderen Arten
  const g2 = fakeGoogle([{ status: 403, text: '{"error":{"code":403,"status":"PERMISSION_DENIED"}}' }]);
  const r2 = await runProbe(probe("list:daily-vo2-max"), "2026-11-25", io(g2.call, "c"));
  assert.equal(r2.ok, false);
  assert.equal(g2.seen.length, 1);
  assert.match(new URL(g2.seen[0].url).searchParams.get("filter")!, /dailyVo2Max\.date/);
  const out2 = JSON.parse(probeJson(probe("list:daily-vo2-max"), r2, "x"));
  assert.equal(out2.status, 403);
  assert.equal(out2.stop, undefined);
  assert.equal(out2.versuche[0].fehler.error.status, "PERMISSION_DENIED");
  assert.deepEqual(out2.antworten, []);
});

test("Google live: Tagessumme per dailyRollUp, Pause (429) und ungültiger Zugang (401) stoppen den Rest", async () => {
  const g = fakeGoogle([{ status: 200, text: '{"rollupDataPoints":[{"steps":{"countSum":"11000"}}]}' }]);
  const r = await runProbe(probe("dailyRollUp:steps"), "2026-11-25", io(g.call));
  assert.equal(g.seen[0].method, "POST");
  assert.match(g.seen[0].url, /\/dataTypes\/steps\/dataPoints:dailyRollUp$/);
  assert.deepEqual(JSON.parse(g.seen[0].body!), rollupBody("2026-11-25"));
  const out = JSON.parse(probeJson(probe("dailyRollUp:steps"), r, "x"));
  assert.equal(out.antworten[0].rollupDataPoints[0].steps.countSum, "11000");
  assert.deepEqual(out.anfrage, rollupBody("2026-11-25"));
  const slow = await runProbe(probe("list:steps"), "2026-11-25", io(fakeGoogle([{ status: 429, text: "", retry: "30" }]).call));
  assert.deepEqual([JSON.parse(probeJson(probe("list:steps"), slow, "x")).stop, JSON.parse(probeJson(probe("list:steps"), slow, "x")).warten], ["pause", "30"]);
  const gone = await runProbe(probe("list:sleep"), "2026-11-25", io(fakeGoogle([{ status: 401, text: "{}" }]).call));
  assert.equal(JSON.parse(probeJson(probe("list:sleep"), gone, "x")).stop, "verbindung");
});

test("Google live: große Antworten gehen als Text unverändert durch, Einheiten ohne Ortsangaben", () => {
  const raw = '{ "dataPoints": [ {"name":"a",  "heartRate": {"beatsPerMinute": "61"}} ] }';
  assert.equal(embedPage(raw, false), raw);
  assert.deepEqual(JSON.parse(embedPage("<html>Fehler</html>", false)), { keinJson: "<html>Fehler</html>" });
  const ex = '{"dataPoints":[{"name":"e","exercise":{"route":{"points":[[52.1,13.4]]},"startLatitude":52.1,"activeDuration":"1800s"}}]}';
  assert.deepEqual(JSON.parse(embedPage(ex, true)), { dataPoints: [{ name: "e", exercise: { activeDuration: "1800s" } }] });
});
