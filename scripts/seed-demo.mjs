// Erzeugt 120 Tage Fantasie-Daten für die LOKALE Datenbank, um die Oberfläche ohne
// Garmin-Schlüssel auszuprobieren. Nie gegen --remote ausführen.
//   npm run seed:demo
import { writeFileSync } from "node:fs";

let seed = 7;
const rnd = (min, max) => { seed = (seed * 16807) % 2147483647; return min + ((seed - 1) / 2147483646) * (max - min); };
const r = (min, max, d = 0) => Number(rnd(min, max).toFixed(d));
const now = Math.floor(Date.now() / 1000);
const day = (i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Ausgedachte Runden (#75): Intervall oder 1-km-Runden
function demoLaps(km, v, hr, intervals) {
  const lap = (m, vv, h) => ({ hr: h, v: +vv.toFixed(3), s: Math.round(m / vv), m: Math.round(m) });
  if (intervals) {
    const out = [lap(2000, v * 0.9, hr - 15), lap(v * 1.1 * 900, v * 1.1, hr + 8)];
    for (let k = 0; k < 5; k++) out.push(lap(800 + rnd(-3, 3), v * 1.25, hr + 14), lap(400, v * 0.75, hr - 5));
    return out;
  }
  const out = [];
  for (let m = km * 1000; m > 0; m -= 1000) out.push(lap(Math.min(1000, m), v * rnd(0.96, 1.04), hr + r(-4, 4)));
  return out;
}

const LAPS = []; // Runden erst setzen, wenn alle Einheiten angelegt sind

// Ausgedachte Runde um das Tempelhofer Feld (Berlin), Umfang ungefähr wie die Distanz, leicht verbeult
function demoRoute(km) {
  const lat0 = 52.4735, lon0 = 13.4015, n = 160;
  const rKm = Math.min(km, 40) / (2 * Math.PI);
  const wob = [rnd(0.05, 0.2), rnd(0.05, 0.2), rnd(0, 6)];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * 2 * Math.PI, f = 1 + wob[0] * Math.sin(3 * t + wob[2]) + wob[1] * Math.cos(5 * t);
    const dLat = (rKm * f * Math.sin(t)) / 111, dLon = (rKm * f * Math.cos(t)) / (111 * Math.cos((lat0 * Math.PI) / 180));
    return [Number((lat0 + dLat).toFixed(5)), Number((lon0 + dLon).toFixed(5))];
  });
}

// Ausgedachtes Puls-Histogramm [bpm, Sekunden, Meter, Sekunden in Bewegung]: Puls streut um den
// Schnitt, höherer Puls = etwas schneller, dazu ein paar Sekunden Stehen
function demoHist(min, hr, v) {
  const acc = new Map();
  for (let t = 0; t < min * 60; t += 5) {
    const bpm = Math.round(hr + (rnd(-1, 1) + rnd(-1, 1) + rnd(-1, 1)) * 9);
    const e = acc.get(bpm) || [0, 0, 0];
    e[0] += 5;
    if (rnd(0, 1) > 0.03) { e[1] += 5 * v * (1 + (bpm - hr) * 0.006); e[2] += 5; }
    acc.set(bpm, e);
  }
  return [...acc].sort((a, b) => a[0] - b[0]).map(([b, [s, m, sm]]) => [b, s, Math.round(m), sm]);
}

// Ausgedachte Verläufe (#17): 300 Abschnitte, Tempo und Puls schwanken leicht, Höhe als sanfte Hügel
function demoStreams(km, min, hr, v, run) {
  const n = 300, ph = rnd(0, 6);
  const out = { d: [], t: [], v: [], hr: [], alt: [], cad: [], pw: [] };
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n, w = Math.sin(f * 9 + ph), hill = Math.sin(f * 5 + ph) * 25 + Math.sin(f * 13) * 8;
    out.d.push(Math.round(km * 1000 * f)); out.t.push(Math.round(min * 60 * f));
    out.v.push(+(v * (1 + 0.06 * w + rnd(-0.008, 0.008)) * (1 - hill / 900)).toFixed(2));
    out.hr.push(Math.round(Math.min(hr + 25, hr - 12 + 18 * Math.min(1, f * 4) + 4 * w + hill / 8)));
    out.alt.push(+(40 + hill).toFixed(1));
    out.cad.push(Math.round(run ? 85 + 2 * w : 88 + 4 * w)); out.pw.push(run ? null : Math.round(200 * (1 + 0.15 * w + hill / 120)));
  }
  if (run) delete out.pw;
  return out;
}

const L = ["DELETE FROM daily_metrics WHERE source = 'demo';", "DELETE FROM activities WHERE source = 'demo';", "DELETE FROM activities WHERE source = 'strava' AND external_id LIKE 's9%';", "DELETE FROM mood;"];
const MOOD_TAGS = ["arbeit", "familie", "freunde", "sport", "draussen", "erholt", "muede", "koffein", "stress"];
// Fitnessalter (#78), ausgedachte Werte
L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('fitAge', ${q(JSON.stringify({ at: new Date().toISOString(), day: day(2), chrono: 38, fit: 31.4, ach: 28.6, prev: 32.1, invalid: null, comps: [
  { key: "vigorousDaysAvg", value: 2.4, target: 4, potential: 29.8, priority: 1, stale: false },
  { key: "rhr", value: 51, target: 48, potential: 30.6, priority: 2, stale: false },
  { key: "bodyFat", value: 18.5, target: 17, potential: 31.1, priority: 3, stale: true },
  { key: "vigorousMinutesAvg", value: 212, target: 150, potential: 31.4, priority: 4, stale: false },
] }))});`);
// Waage (#3): ausgedachte Messungen an etwa 2 von 3 Tagen, leicht fallendes Gewicht (ohne rnd, damit die übrigen Demodaten gleich bleiben)
for (let i = 0; i < 120; i++) {
  if (i % 3 === 2) continue;
  const kg = +(76.2 + i * 0.012 + Math.sin(i / 6) * 0.4 + Math.sin(i * 1.7) * 0.1).toFixed(1), fat = +(17.8 + i * 0.008 + Math.sin(i / 6) * 0.25).toFixed(1);
  const w = { kg, fat, muscle: +(kg * 0.79 * (1 - fat / 100) / 0.82).toFixed(1), water: +(kg * 0.58).toFixed(1), bone: 3.2, visceral: 6 };
  for (const [k, v] of Object.entries(w)) L.push(`INSERT OR REPLACE INTO daily_metrics VALUES (${q(day(i))},${q(k)},'demo',${v},${now});`);
}
for (let i = 0; i < 120; i++) {
  const d = day(i);
  const slp = r(5.8, 8.4, 2);
  const m = {
    rhr: r(44, 52), stress: r(18, 40), bbMax: r(62, 100), bbMin: r(5, 30), steps: r(4000, 15000), vig: r(0, 60), mod: r(0, 40),
    slp, deep: +(slp * r(.14, .22, 2)).toFixed(2), rem: +(slp * r(.18, .25, 2)).toFixed(2), awake: r(5, 40), score: r(58, 92),
    shr: r(46, 54), resp: r(13, 16, 1), bed: r(22.5, 25, 2), wake: r(6.3, 8, 2),
    hrv: r(48, 72), hrvWk: r(56, 62), hrvLo: 52, hrvHi: 70,
    stressMax: r(60, 95), stRest: r(240, 480), stLow: r(120, 300), stMed: r(30, 150), stHi: r(0, 60), bbCharged: r(35, 75), bbDrained: r(40, 80), bbNow: r(20, 70), bbWake: r(70, 100),
  };
  for (const [k, v] of Object.entries(m)) L.push(`INSERT OR REPLACE INTO daily_metrics VALUES (${q(d)},${q(k)},'demo',${v},${now});`);
  // Ausgedachte Stimmung an etwa 3 von 4 Tagen, besser nach langem Schlaf
  if (i > 0 && i < 60 && r(0, 3) > 0) {
    const v = Math.max(1, Math.min(5, Math.round(2.2 + (slp - 6) * 0.8 + rnd(-1, 1))));
    const tags = MOOD_TAGS.filter(() => rnd(0, 1) < 0.18);
    L.push(`INSERT OR REPLACE INTO mood VALUES (${q(d)},${v},${q(JSON.stringify(tags))},NULL,${now});`);
  }
  // Ausgedachter Body-Battery-Verlauf für heute (#79): nachts aufladen, tagsüber verbrauchen
  if (i === 0) {
    const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes(), pts = [];
    let lvl = 30;
    for (let t = 0; t <= nowMin; t += 15) { lvl = t < 420 ? Math.min(96, lvl + 4) : Math.max(5, lvl - (t > 1020 && t < 1080 ? 6 : rnd(0, 1.4))); pts.push([t, Math.round(lvl)]); }
    L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('bbCurves', ${q(JSON.stringify({ at: new Date().toISOString(), curves: [{ day: d, pts }] }))});`);
  }

  if (i % 2 === 0) {
    const run = i % 4 === 0;
    const km = run ? r(6, 16, 2) : r(30, 90, 2);
    const v = run ? r(2.9, 3.6, 3) : r(7, 9, 3);
    const min = +((km * 1000) / v / 60).toFixed(1);
    const label = ["RECOVERY", "AEROBIC_BASE", "AEROBIC_BASE", "TEMPO", "LACTATE_THRESHOLD", "VO2MAX"][r(0, 5)];
    const hr = r(128, 165);
    // Ausgedachte Runden: jeder 2. Lauf als Intervall (Einlaufen, 15 min Tempo, 5 × 800 m mit Trabpausen), sonst 1-km-Runden
    if (run) LAPS.push(`UPDATE activities SET laps = ${q(JSON.stringify(demoLaps(km, v, hr, i % 8 === 0)))} WHERE source = 'demo' AND external_id = ${q("demo" + i)};`);
    const z = [r(0, 300), r(300, 1500), r(300, 1500), r(0, 800), r(0, 300)];
    const a = {
      id: "demo" + i, date: d, start: "07:30", type: run ? "running" : "road_biking", name: "", km, min, hr, maxHr: hr + 20,
      spd: v, gap: v, cad: run ? r(165, 180) : null, gct: run ? r(230, 260) : null, vo: run ? r(8, 9.5, 1) : null,
      pw: run ? null : r(170, 240), np: null, elev: r(20, 600), te: r(2, 4.5, 1), teAn: r(0, 3, 1), load: r(40, 220, 1), label, z,
      f5k: run && km >= 5 ? Math.round(5000 / v) : null, f10k: run && km >= 10 ? Math.round(10000 / v) : null, fHm: null, fM: null,
      vo2: run ? Math.round(52 - i / 30) : Math.round(50 - i / 40),
      kcal: Math.round(min * (run ? 11 : 9)),
    };
    L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route, route_done, hr_hist, streams, updated_at) VALUES ('demo', ${q(a.id)}, ${q(d)}, ${q(a.type)}, ${q(JSON.stringify(a))}, 1, ${q(JSON.stringify(demoRoute(km)))}, 1, ${q(JSON.stringify(demoHist(min, hr, v)))}, ${q(JSON.stringify(demoStreams(km, min, hr, v, run)))}, ${now});`);
    // Strava (#44): dieselbe Einheit noch einmal mit Strava-Extras (wird beim Laden zusammengeführt)
    if (i < 30) {
      const sa = { id: "s9" + i, sid: "9" + i, src: "strava", date: d, start: "07:31", type: a.type, name: run ? "Morgenrunde" : "Ausfahrt", km: +(km * 1.004).toFixed(2), min,
        hr, re: r(20, 220), kudos: r(0, 30), comments: r(0, 4), prs: r(0, 3), ach: r(0, 8), photos: 0, commute: false, wt: run ? r(0, 3) : 10, z: [0, 0, 0, 0, 0] };
      L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route, route_done, updated_at) VALUES ('strava', ${q(sa.id)}, ${q(d)}, ${q(sa.type)}, ${q(JSON.stringify(sa))}, 1, '[]', 1, ${now});`);
    }
  }
}
// Ein ausgedachter eigener VO2max-Eintrag (die übrigen Werte kommen automatisch aus den Einheiten)
L.push("DELETE FROM vo2;");
for (const [i, v] of [[30, 50]]) L.push(`INSERT INTO vo2 (day, sport, value) VALUES (${q(day(i))}, 'run', ${v});`);
{
  const d = day(1);
  const sa = { id: "s9001", sid: "9001", src: "strava", date: d, start: "19:03", type: "virtual_ride", name: "Rolle", km: 0, min: 54.2, hr: 138, maxHr: 158, pw: 205, pwMeasured: true,
    re: 116, kudos: 19, comments: 2, prs: 0, ach: 0, photos: 0, trainer: true, commute: false, wt: null, z: [0, 0, 0, 0, 0] };
  L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route, route_done, updated_at) VALUES ('strava', 's9001', ${q(d)}, 'virtual_ride', ${q(JSON.stringify(sa))}, 1, '[]', 1, ${now});`);
}
L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('meta', ${q(JSON.stringify({ lastRecent: new Date().toISOString(), complete: true, oldest: day(119), lapsPending: 0 }))});`);
writeFileSync(new URL("./.demo-seed.sql", import.meta.url), [...L, ...LAPS].join("\n"));
console.log(`Demo-SQL mit ${L.length} Zeilen geschrieben.`);
