// Tests für den Rad-Wetter-Planer (#153). Nur ausgedachte Wetterlagen und Fahrten. Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badges, bestWindow, challenge, cleanCrit, cleanWear, DEFAULT_CRIT, DEFAULT_WEAR, fcUrl, feelOnBike, findWindows, fmt, levelFor,
  learned, localOf, logDays, mergeLog, nextWindow, parseForecast, pushMsg, pushPlan, rankRoutes, rateHours, records, rideChill,
  roadFilm, roadState, routeInfo, streak, tzOffset, usedWindows, wardrobe, wearFor, windAdvice, windMean, type Fb, type Hour, type Log,
  type RideAct, type Win,
} from "../src/radwetter.ts";

// Donnerstag, 19.11.2026, 00:00 Uhr in Berlin (MEZ, UTC+1)
const T0 = Date.UTC(2026, 10, 18, 23, 0) / 1000;
/** Stunden ab T0 mit angenehmen Grundwerten, einzelne Werte je Stunde überschreibbar */
function mk(n: number, f: (i: number, h: number) => Partial<Hour> = () => ({})): Hour[] {
  return Array.from({ length: n }, (_, i) => {
    const e = T0 + i * 3600, loc = localOf(e, 3600);
    const light = loc.h >= 8 && loc.h < 16 ? 60 : 0;
    return { e, ...loc, t: 12, ta: 11, rh: 70, p: 0, pp: 0, c: 1, cc: 30, ws: 10, wg: 20, wdir: 270, sun: light ? 20 : 0, light, ...f(i, loc.h) };
  });
}
const cfg = (x: Partial<typeof DEFAULT_WEAR> = {}) => ({ ...DEFAULT_WEAR, ...x });

test("Open-Meteo: mehrere Orte in einer Anfrage, auf 0,01° gerundet, Zeit als Unix-Sekunden", () => {
  const u = new URL(fcUrl([[52.51234, 13.40987], [52.399, 13.0661]]));
  assert.equal(u.hostname, "api.open-meteo.com");
  assert.equal(u.searchParams.get("latitude"), "52.51,52.40");
  assert.equal(u.searchParams.get("longitude"), "13.41,13.07");
  assert.equal(u.searchParams.get("timeformat"), "unixtime");
  assert.equal(u.searchParams.get("past_days"), "1");
  assert.match(u.searchParams.get("hourly") || "", /precipitation_probability/);
});

test("Vorhersage einlesen: Regen der Stunde davor verschoben, Ortszeit mit Sommerzeit-Wechsel", () => {
  const time = Array.from({ length: 6 }, (_, i) => T0 + i * 3600);
  const json = {
    timezone: "Europe/Berlin", utc_offset_seconds: 3600,
    hourly: {
      time, temperature_2m: [10, 12, 14, 14, 14, 14], apparent_temperature: [8, 10, 12, 12, 12, 12], relative_humidity_2m: [80, 80, 80, 80, 80, 80],
      precipitation: [0, 0, 2, 0, 0, 0], precipitation_probability: [0, 10, 90, 20, 0, 0], weather_code: [1, 1, 63, 3, 1, 1], cloud_cover: [10, 20, 90, 60, 20, 10],
      wind_speed_10m: [10, 10, 20, 20, 10, 10], wind_gusts_10m: [20, 20, 40, 30, 20, 20], wind_direction_10m: [350, 10, 270, 270, 270, 270], is_day: [0, 0, 0, 0, 0, 0], sunshine_duration: [0, 0, 0, 0, 0, 0],
    },
    daily: { sunrise: [T0 + 7.5 * 3600], sunset: [T0 + 16.2 * 3600] },
  };
  const fc = parseForecast(json)!;
  assert.equal(fc.hours.length, 5); // letzte Stunde hat kein „danach“
  assert.equal(fc.hours[0].d, "2026-11-19");
  assert.equal(fc.hours[0].h, 0);
  assert.equal(fc.hours[0].wd, 4); // Donnerstag
  assert.equal(fc.hours[1].p, 2); // Regen von 01–02 Uhr steht bei 02:00
  assert.equal(fc.hours[1].c, 63);
  assert.equal(fc.hours[0].t, 11); // Mittel aus 00:00 und 01:00
  assert.equal(fc.hours[0].wdir, 0); // 350° und 10° ergeben Norden
  assert.equal(parseForecast({}), null);
  // Umstellung auf Sommerzeit: 29.03.2026, 01:00 UTC = 03:00 MESZ
  const t1 = Date.UTC(2026, 2, 28, 23, 0) / 1000;
  const dst = parseForecast({ timezone: "Europe/Berlin", hourly: { time: [0, 1, 2, 3].map((i) => t1 + i * 3600), temperature_2m: [1, 1, 1, 1] } })!;
  assert.deepEqual(dst.hours.map((h) => h.h), [0, 1, 3]);
  // Zeitpunkt mit Sekunden: trotzdem genau eine Stunde Abstand
  assert.equal(tzOffset("Europe/Berlin", T0 + 1234 + 35), 3600);
  assert.equal(tzOffset("Europe/Berlin", t1 + 2 * 3600 + 59), 7200);
});

test("Straße: Wasserfilm füllt sich mit Regen und trocknet ab, Sonne schneller, nachts langsamer", () => {
  // 2 mm Regen um 9 Uhr (Film höchstens 1,2 mm), danach trocken, hell, 12 °C, etwas Sonne (20 min, zählt nicht)
  const hs = mk(16, (i, h) => (h === 9 ? { p: 2 } : {}));
  const film = roadFilm(hs, 3);
  assert.equal(film[10], 1.2);
  assert.equal(roadState(film[10], 0), "nass");
  // 0,4 mm je Stunde: nach 3 Stunden trocken
  assert.equal(film[13], 0);
  assert.equal(roadState(film[12], 0), "nass");
  // Mit Sonne (ab 30 min) 1,5-mal so schnell
  const sunny = roadFilm(mk(16, (i, h) => (h === 9 ? { p: 2 } : { sun: 45 })), 3);
  assert.ok(sunny[12] < 0.05);
  // Nachts (kein Tageslicht) 0,6-mal: um 2 Uhr geregnet, um 5 Uhr noch nass
  const night = roadFilm(mk(8, (i, h) => (h === 1 ? { p: 2 } : {})), 3);
  assert.ok(night[5] > 0.3);
  assert.equal(roadState(0.1, 0), "feucht");
  assert.equal(roadState(0, 0.4), "nass");
});

test("Fenster: nach dem Regen erst, wenn die Straße trocken ist; nur hell und in deinen Zeiten", () => {
  const hs = mk(24, (i, h) => (h === 9 ? { p: 1.5, pp: 90 } : {}));
  const crit = { ...DEFAULT_CRIT };
  const rated = rateHours(hs, crit);
  assert.equal(rated[9].st, "bad");
  assert.deepEqual(rated[9].why, ["Regen 1,5 mm", "Regenrisiko 90 %"]);
  assert.equal(rated[10].why[0], "Straße nass");
  assert.equal(rated[20].off, "dunkel");
  assert.equal(rated[3].off, "zeit");
  const wins = findWindows(hs, rated, crit);
  // 08–09 ist nur eine Stunde (Mindestdauer 2 h); nach dem Regen um 9 Uhr ab 13 Uhr trocken, hell bis 16 Uhr
  assert.equal(wins.length, 1);
  assert.equal(wins[0].h0, 13);
  assert.equal(wins[0].h1, 16);
  assert.equal(wins[0].n, 3);
  assert.equal(wins[0].d, "2026-11-19");
  // Ohne Tageslicht-Bedingung und ohne trockene Straße: länger
  const loose = { ...crit, light: false, dry: false };
  const w2 = findWindows(hs, rateHours(hs, loose), loose);
  assert.equal(w2[0].h0, 6);
  assert.equal(w2[1].h0, 10);
  assert.equal(w2[1].h1, 21);
  // Wochentag abgewählt (Do = 4)
  const noThu = { ...crit, days: crit.days.map((x, i) => i !== 4) };
  assert.equal(findWindows(hs, rateHours(hs, noThu), noThu).length, 0);
});

test("Fenster: knapp verfehlt (weich) gegen klar schlecht, nächstes und bestes Fenster", () => {
  const hs = mk(48, (i, h) => ({ sun: h >= 8 && h < 16 ? 45 : 0, ws: i < 24 ? 28 : 12, t: i < 24 ? 9 : 15 }));
  const crit = { ...DEFAULT_CRIT };
  const rated = rateHours(hs, crit);
  assert.equal(rated[10].st, "meh"); // Wind 28 bei Grenze 25: knapp
  assert.deepEqual(rated[10].why, ["Wind 28 km/h"]);
  const wins = findWindows(hs, rated, crit);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].d, "2026-11-20");
  assert.equal(nextWindow(wins, T0)?.h0, 8);
  assert.equal(bestWindow(wins, T0)?.n, 8);
  assert.equal(nextWindow(wins, T0 + 60 * 3600), null);
});

test("Kriterien aus der Oberfläche werden geprüft und begrenzt", () => {
  const c = cleanCrit({ prob: 300, wind: "18", tMin: "", tMax: 50, minH: 0, days: [false, false, false, false, false, false, false], wk: [22, 8] });
  assert.equal(c.prob, 100);
  assert.equal(c.wind, 18);
  assert.equal(c.tMin, null);
  assert.equal(c.tMax, 45);
  assert.equal(c.minH, 1);
  assert.ok(c.days.every(Boolean)); // keiner gewählt: alle
  assert.deepEqual(c.wk, [6, 21]);
  assert.deepEqual(cleanCrit(null), DEFAULT_CRIT);
});

test("Wind: erst gegen den Wind raus, Runde mit Halbzeit gegen den Wind passt am besten", () => {
  assert.match(windAdvice(270, 18).text, /Fahr zuerst Richtung Westen/);
  assert.equal(windAdvice(270, 6).kind, "ruhig");
  assert.equal(windAdvice(270, 20, { bear: 260, spread: 12 }).kind, "gut");
  assert.equal(windAdvice(270, 20, { bear: 90, spread: 12 }).kind, "schlecht");
  assert.equal(windAdvice(270, 20, { bear: 0, spread: 12 }).kind, "seite");
  assert.equal(windAdvice(270, 20, { bear: 270, spread: 1 }).kind, "kurz");
  const ranked = rankRoutes([
    { id: "ost", bear: 90, spread: 15, km: 40 },
    { id: "west", bear: 275, spread: 15, km: 40 },
    { id: "lang", bear: 270, spread: 30, km: 120 },
  ], { dir: 270, ws: 20 }, 3, 27);
  assert.deepEqual(ranked.map((r) => r.id), ["west", "lang", "ost"]);
  assert.equal(ranked[1].fits, false); // 120 km passen nicht in 3 h
  const m = windMean([{ ws: 10, wg: 20, wdir: 350 }, { ws: 10, wg: 25, wdir: 10 }]);
  assert.equal(m.dir, 0);
  assert.equal(m.wg, 25);
});

test("Lieblingsrunde: Halbzeit, Richtung, Mitte und Skizze ohne Koordinaten", () => {
  // Ausgedacht: 20 km nach Westen und zurück
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) pts.push([52.5, 13.4 - (i * 0.0147)]);
  for (let i = 19; i >= 0; i--) pts.push([52.5 + 0.0005, 13.4 - (i * 0.0147)]);
  const r = routeInfo(pts)!;
  assert.ok(r.km > 39 && r.km < 41, String(r.km));
  assert.ok(r.bear > 260 && r.bear < 280, String(r.bear));
  assert.ok(r.spread > 18 && r.spread < 21, String(r.spread));
  assert.deepEqual(r.c, [52.5, 13.25]);
  assert.ok(r.sk.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
  assert.equal(routeInfo([[52, 13]]), null);
});

test("Fahrtwind und gefühlt auf dem Rad", () => {
  assert.equal(rideChill(27, 20), 2.7);
  assert.equal(rideChill(27, 0), 5.4);
  assert.equal(rideChill(27, 7.5), 4.1);
  assert.equal(rideChill(0, 0), 0);
  assert.equal(feelOnBike({ t: 20, ta: 19 }, 27), 16.3);
  assert.equal(feelOnBike({ t: 20, ta: 19 }, 27, 1), 15.3); // friert schneller: 1 °C kälter
  assert.equal(levelFor(15, DEFAULT_WEAR.lv), "kk");
  assert.equal(levelFor(8, DEFAULT_WEAR.lv), "lk");
  assert.equal(levelFor(-1, DEFAULT_WEAR.lv), "ll");
  assert.equal(levelFor(-1.1, DEFAULT_WEAR.lv), "wi");
  assert.equal(levelFor(15, { ...DEFAULT_WEAR.lv, kk: null, kl: 12 }), "kl");
});

test("Kleidung: warm und trocken = kurz-kurz", () => {
  const hs = mk(24, () => ({ t: 21, ta: 20, ws: 8 }));
  const w = wearFor(hs, roadFilm(hs), 10, 120, cfg())!;
  assert.equal(w.lvl, "kk");
  assert.deepEqual(w.items.map((x) => x.id), ["handschuhKurz"]);
  assert.deepEqual(w.parts, ["trikotKurz", "hoseKurz", "handschuhKurz"]);
  assert.match(w.why, /kurz-kurz \(ab 14 °C\)/);
  assert.doesNotMatch(w.why, / bis /); // gleiche Werte nur einmal
});

test("Kleidung: kühl und windig = lang-lang mit Windjacke statt Gilet", () => {
  const hs = mk(24, () => ({ t: 8, ta: 5, ws: 28, wg: 48 }));
  const w = wearFor(hs, roadFilm(hs), 10, 120, cfg())!;
  assert.equal(w.ride.fMin, 1);
  assert.equal(w.lvl, "ll");
  assert.deepEqual(w.items.map((x) => x.id), ["unterhemd", "windjacke", "handschuhLang"]);
  const wj = w.items.find((x) => x.id === "windjacke")!;
  assert.equal(wj.why, "gefühlt 1 °C (unter 5), Wind 28 km/h (ab 25)");
});

test("Kleidung: nass = Regenjacke, Überschuhe, nasse Stunden kälter gerechnet", () => {
  const hs = mk(24, () => ({ t: 11, ta: 9, p: 1.2, pp: 90, ws: 15 }));
  const w = wearFor(hs, roadFilm(hs), 10, 120, cfg())!;
  assert.equal(w.ride.fMin, 2.6); // 9 − 3,4 Fahrtwind − 3 Nässe
  assert.equal(w.lvl, "ll");
  assert.deepEqual(w.items.map((x) => x.id), ["unterhemd", "regenjacke", "handschuhLang", "ueberschuhe"]);
  assert.match(w.why, /nasse Stunden 3 °C kälter/);
  assert.ok(w.parts.includes("regenjacke"));
  // Ohne Nässe-Abzug wäre es lang-kurz knapp verfehlt, aber trocken nur Unterhemd und kurze Hose mit Knielingen
  const dry = mk(24, () => ({ t: 13, ta: 12, ws: 8 }));
  assert.deepEqual(wearFor(dry, roadFilm(dry), 10, 120, cfg())!.items.map((x) => x.id), ["handschuhKurz", "knielinge"]);
});

test("Kleidung: wird es deutlich wärmer, abnehmbare Teile statt dickerer Grundstufe", () => {
  // Start gefühlt 3 °C, nach drei Stunden knapp 15 °C (Schnitt 9 °C)
  const hs = mk(24, (i) => ({ t: 8 + (i - 8) * 3.5, ta: 7 + (i - 8) * 3.5, ws: 8 }));
  const w = wearFor(hs, roadFilm(hs), 8, 240, cfg())!;
  assert.deepEqual(w.ride.f, [3, 7.2, 11.3, 14.8]);
  assert.equal(w.lvl, "lk");
  // Beinlinge statt langer Hose, Gilet zum Ausziehen, lange Handschuhe für den kalten Start (kurze ersetzt)
  assert.deepEqual(w.items.map((x) => x.id), ["unterhemd", "gilet", "handschuhLang", "beinlinge"]);
  assert.match(w.items.find((x) => x.id === "beinlinge")!.why, /zum Ausziehen/);
  assert.match(w.why, /Grundstufe nach dem Schnitt/);
  // Gleiche Fahrt, aber nur eine Stunde: kein Wechsel, Grundstufe nach dem kältesten Moment
  assert.equal(wearFor(hs, roadFilm(hs), 8, 60, cfg())!.lvl, "ll");
});

test("Kleidung: eigene Regeln und Teile, Prüfung der Eingaben", () => {
  const own = cleanWear({ speed: 30, lv: { kk: 18, kl: null, lk: 10, ll: 0 }, items: [
    ...DEFAULT_WEAR.items.map((x) => (x.id === "muetze" ? { ...x, on: false } : x)),
    { id: "elicht", name: "  Rücklicht  extra ", rules: [{ dark: true }] },
    { id: "böse", name: "X", rules: [] },
  ] });
  assert.equal(own.speed, 30);
  assert.equal(own.lv.kk, 18);
  assert.equal(own.items.find((x) => x.id === "elicht")!.name, "Rücklicht extra");
  assert.equal(own.items.some((x) => x.id === "böse"), false);
  assert.equal(own.items.find((x) => x.id === "muetze")!.on, false);
  // Grenzen nicht absteigend: Vorschläge
  assert.deepEqual(cleanWear({ lv: { kk: 5, kl: null, lk: 10, ll: 0 } }).lv, DEFAULT_WEAR.lv);
  const hs = mk(24, () => ({ t: 3, ta: 1 }));
  const w = wearFor(hs, roadFilm(hs), 17, 120, own)!;
  assert.ok(w.items.some((x) => x.id === "elicht" && x.part === null));
  assert.ok(!w.items.some((x) => x.id === "muetze"));
});

test("Rückmeldungen: je „zu kalt“ 0,5 °C kälter rechnen, höchstens 4 °C, Treffsicherheit und Serie", () => {
  const fb: Fb[] = [
    { id: "a", d: "2026-11-01", v: -1, f: 6 }, { id: "b", d: "2026-11-03", v: -1, f: 7 },
    { id: "c", d: "2026-11-05", v: 0 }, { id: "d", d: "2026-11-07", v: 1 }, { id: "e", d: "2026-11-09", v: 0 }, { id: "f", d: "2026-11-10", v: 0 },
  ];
  const l = learned(fb);
  assert.equal(l.bias, 0.5);
  assert.deepEqual(l.moves.map((m) => m.to), [0.5, 1, 0.5]);
  const many = Array.from({ length: 12 }, (_, i): Fb => ({ id: "x" + i, d: "2026-10-" + String(10 + i), v: -1 }));
  assert.equal(learned(many).bias, 4);
  const wr = wardrobe(fb);
  assert.deepEqual(wr, { n: 6, ok: 3, quote: 50, streak: 2, best: 2 });
});

/** Fenster wie aus findWindows, für Mitteilungen */
const win = (s: number, n: number, extra: Partial<Win> = {}): Win => {
  const loc = localOf(s, 3600);
  return { i: 0, n, s, e: s + n * 3600, d: loc.d, wd: loc.wd, h0: loc.h, h1: loc.h + n, score: 80, t: [12, 14], ta: [10, 12], ws: 12, wg: 25, wdir: 225, pp: 10, sun: 120, ...extra };
};

test("Mitteilungen: neues Fenster einmal melden, Abstand und Tageslimit, Verschiebung, Ausfall, Erinnerung", () => {
  const now = T0 + 9 * 3600; // 10 Uhr
  const opt = { announce: true, remind: 30 };
  const w1 = win(T0 + 14 * 3600, 3); // heute 14–17 Uhr (MEZ: e + 1 h)
  let r = pushPlan([w1], {}, now, "10:00", "2026-11-19", opt);
  assert.equal(r.kind, "neu");
  assert.deepEqual(r.state.known, [[w1.s, w1.e]]);
  // gleich danach nichts mehr (schon gemeldet, außerdem 3 h Abstand)
  assert.equal(pushPlan([w1], r.state, now + 600, "10:10", "2026-11-19", opt).kind, null);
  // 4 h später um 2 h verschoben: „anders“
  const moved = win(T0 + 16 * 3600, 3);
  const r2 = pushPlan([moved], r.state, now + 4 * 3600, "14:00", "2026-11-19", opt);
  assert.equal(r2.kind, "anders");
  assert.deepEqual(r2.old, [w1.s, w1.e]);
  // Nachts keine Ankündigung
  assert.equal(pushPlan([win(T0 + 34 * 3600, 3)], {}, T0 + 22 * 3600, "23:00", "2026-11-19", opt).kind, null);
  // Fenster weg: „weg“
  const r3 = pushPlan([], r.state, now + 4 * 3600, "14:00", "2026-11-19", opt);
  assert.equal(r3.kind, "weg");
  assert.deepEqual(r3.state.known, []);
  // Erinnerung 30 min vorher, nur einmal
  const r4 = pushPlan([w1], r.state, w1.s - 25 * 60, "13:35", "2026-11-19", opt);
  assert.equal(r4.kind, "los");
  assert.equal(pushPlan([w1], r4.state, w1.s - 15 * 60, "13:45", "2026-11-19", opt).kind, null);
  // höchstens 2 Ankündigungen am Tag
  const busy = { day: "2026-11-19", n: 2, last: now - 5 * 3600, known: [] as Array<[number, number]> };
  assert.equal(pushPlan([w1], busy, now, "10:00", "2026-11-19", opt).kind, null);
  // ausgeschaltet
  assert.equal(pushPlan([w1], {}, now, "10:00", "2026-11-19", { announce: false, remind: 0 }).kind, null);
});

test("Mitteilungen: Texte mit Tag, Uhrzeit, Wetter und Wind-Rat", () => {
  const w = win(T0 + 34 * 3600, 4); // Freitag 10–14 Uhr
  const m = pushMsg("neu", { today: "2026-11-19", now: T0, win: w });
  assert.equal(m.title, "🚴 Gutes Fenster morgen");
  assert.equal(m.body, "Morgen 10–14 Uhr: trocken, 12–14 °C, Wind 12 km/h aus SW.");
  const los = pushMsg("los", { today: "2026-11-20", now: w.s - 30 * 60, win: w, advice: windAdvice(225, 12) });
  assert.equal(los.title, "⏱ In 30 Minuten geht's los");
  assert.match(los.body, /^Trocken bis 14 Uhr, .*Erst Richtung SW, gegen den Wind\.$/);
  assert.match(pushMsg("weg", { today: "2026-11-19", now: T0, oldText: "morgen 10–14 Uhr" }).body, /^Morgen 10–14 Uhr wird laut Vorhersage nichts/);
  assert.equal(fmt(-0.04), "0");
  assert.equal(fmt(-2.5, 1), "−2,5");
});

const rides: RideAct[] = [
  { id: "r1", date: "2026-11-02", start: "06:40", min: 90, km: 40, wx: { t: 2, ws: 12, c: 3 } },
  { id: "r2", date: "2026-11-04", start: "15:10", min: 120, km: 55, wx: { t: 9, ws: 30, c: 61 } },
  { id: "r3", date: "2026-11-11", start: "10:05", min: 60, km: 28, wx: { t: 11, ws: 8, c: 0 } },
  { id: "r4", date: "2026-11-11", start: "11:30", min: 60, km: 25 },
  { id: "r5", date: "2026-11-18", start: "17:45", min: 60, km: 25 },
];
const log: Log = {
  "2026-11-02": { w: [[7, 11, 70]] },
  "2026-11-04": { w: [[14, 17, 75]] },
  "2026-11-05": { w: [[10, 13, 90]] },
  "2026-11-11": { w: [[10, 14, 85]] },
  "2026-11-12": { w: [[9, 12, 60]] },
  // Woche ab 16.11.: 18. ohne passendes Fenster, 20. noch vorhergesagt
  "2026-11-18": { w: [[10, 12, 70]] },
  "2026-11-20": { w: [[11, 15, 88]] },
};

test("Dranbleiben: genutzte Fenster, Wochenziel, Serie (Wochen ohne Fenster zählen nicht)", () => {
  const used = usedWindows(rides, log);
  // r1 startet 6:40 (bis 30 min vor dem Fenster zählt), r2 in 14–17, r3 und r4 im selben Fenster (einmal), r5 außerhalb
  assert.deepEqual(used.map((u) => u.ride), ["r1", "r2", "r3"]);
  const ch = challenge(log, used, "2026-11-19", 2, 12);
  assert.deepEqual(ch, { goal: 2, target: 2, avail: 2, ahead: 1, used: 0, done: false });
  const st = streak(log, used, "2026-11-19");
  // KW 45 (2.–8.11.) genutzt, KW 46 (9.–15.11.) genutzt, KW 47 läuft noch
  assert.equal(st.cur, 2);
  assert.equal(st.best, 2);
  assert.equal(st.since, "2026-11-02");
});

test("Dranbleiben: Abzeichen mit Stufen und Wetter-Rekorde", () => {
  const used = usedWindows(rides, log);
  const fb: Fb[] = [{ id: "r1", d: "2026-11-02", v: 0 }, { id: "r2", d: "2026-11-04", v: 0 }, { id: "r3", d: "2026-11-11", v: 0 }];
  const b = Object.fromEntries(badges(rides, used, log, fb, "2026-11-19").map((x) => [x.id, x]));
  assert.equal(b.fenster.n, 3);
  assert.equal(b.fenster.tier, 1);
  assert.equal(b.fenster.next, 10);
  assert.equal(b.frueh.n, 1);
  assert.equal(b.kalt.n, 1); // 2 °C
  assert.equal(b.regen.n, 1); // Code 61
  assert.equal(b.wind.n, 1); // 30 km/h
  assert.equal(b.perfekt.n, 1); // 11.11. war das beste Fenster seiner Woche
  assert.equal(b.garderobe.tier, 1);
  assert.equal(b.allwetter.n, 3); // Wolken, Regen, Sonne
  const rec = Object.fromEntries(records(rides).map((x) => [x.key, x]));
  assert.equal(rec.kalt.value, "2 °C");
  assert.equal(rec.wind.id, "r2");
  assert.equal(rec.frueh.value, "6:40 Uhr");
});

test("Protokoll: Fenster je Tag, unvollständige Tage überschreiben nichts", () => {
  const hs = mk(30, (i, h) => (h === 9 ? { p: 1.5, pp: 90 } : {}));
  const rated = rateHours(hs, DEFAULT_CRIT);
  const lg = logDays(hs, findWindows(hs, rated, DEFAULT_CRIT));
  assert.deepEqual(lg["2026-11-19"].w, [[13, 16, lg["2026-11-19"].w[0][2]]]);
  assert.equal(lg["2026-11-19"].t![10], 12);
  // 20.11. nur 6 Stunden in den Daten: altes Fenster bleibt
  const merged = mergeLog({ "2026-11-20": { w: [[9, 12, 70]] }, "2025-01-01": { w: [] } }, lg, 2);
  assert.deepEqual(merged["2026-11-20"].w, [[9, 12, 70]]);
  assert.equal(merged["2025-01-01"], undefined); // nur 2 Tage behalten
});
