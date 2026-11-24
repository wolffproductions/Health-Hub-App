// Erzeugt 120 Tage Fantasie-Daten für die LOKALE Datenbank, um die Oberfläche ohne
// Garmin-Schlüssel auszuprobieren. Nie gegen --remote ausführen.
//   npm run seed:demo
import { readFileSync, writeFileSync } from "node:fs";

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
    // Wie ein strukturiertes Training auf der Uhr (#105): Aufwärmen, Belastung (aktiv), Erholung, alles per Taste
    return out.map((l, i) => ({ ...l, it: i === 0 ? 2 : i === 1 || i % 2 === 0 ? 0 : 4, tg: 0 }));
  }
  const out = [];
  for (let m = km * 1000; m > 0; m -= 1000) out.push(lap(Math.min(1000, m), v * rnd(0.96, 1.04), hr + r(-4, 4)));
  // Normaler Lauf: Auto-Runde je Kilometer, die letzte endet mit der Einheit
  return out.map((l, i) => ({ ...l, it: 0, tg: i === out.length - 1 ? 7 : 2 }));
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
// Ausgedachte Bestleistungen (wie aus der .fit): kürzere Strecken etwas schneller, kurze Zeitfenster mehr Watt
function demoBest(km, min, v, run, pw) {
  const d = {}, p = {};
  for (const D of [400, 805, 1000, 1609, 3219, 5000, 10000, 15000, 16093, 20000, 21097, 30000, 40000, 42195, 50000, 80000, 100000, 160934]) {
    if (D > km * 1000) break;
    d[D] = Math.round(D / (v * (1 + 0.14 * (1 - D / (km * 1000))) * rnd(0.98, 1.03)));
  }
  if (!run && pw) for (const W of [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200]) {
    if (W > min * 60) break;
    p[W] = Math.round(pw * (1 + 2.6 * Math.exp(-W / 25) + 0.35 * Math.exp(-W / 500)) * rnd(0.96, 1.04));
  }
  return { d, p };
}

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
  // Zwei Pausen (#152, Ampel und Trinkpause), ohne rnd, damit die übrigen Demodaten gleich bleiben
  if (km > 3) out.p = [[Math.round(km * 370), 48], [Math.round(km * 710), 26]];
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
    L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route, route_done, hr_hist, streams, best, updated_at) VALUES ('demo', ${q(a.id)}, ${q(d)}, ${q(a.type)}, ${q(JSON.stringify(a))}, 1, ${q(JSON.stringify(demoRoute(km)))}, 1, ${q(JSON.stringify(demoHist(min, hr, v)))}, ${q(JSON.stringify(demoStreams(km, min, hr, v, run)))}, ${q(JSON.stringify(demoBest(km, min, v, run, a.pw)))}, ${now});`);
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
// WHOOP (#119), nur mit DEMO_WHOOP=1: ausgedachte Recovery, Nächte und Strain der letzten 60 Tage, dazu WHOOP-Einheiten
// (dieselben Läufe wie die Uhr, werden zusammengeführt, plus ein paar nur von WHOOP). Ohne rnd, damit der Rest gleich bleibt.
L.push("DELETE FROM daily_metrics WHERE source = 'whoop';", "DELETE FROM activities WHERE source = 'whoop';", "DELETE FROM kv WHERE key IN ('whoopApp', 'whoopTokens', 'whoopMeta');");
if (process.env.DEMO_WHOOP === "1") {
  for (let i = 0; i < 60; i++) {
    const w = 0.5 + 0.5 * Math.sin(i * 1.3) * Math.cos(i / 5);
    const slp = +(6.4 + 1.6 * w).toFixed(2);
    const m = { rec: Math.round(28 + 60 * w), hrv: Math.round(52 + 22 * w), rhr: Math.round(54 - 6 * w), spo2: 96.1, skinT: +(33.4 + 0.3 * Math.cos(i)).toFixed(1),
      slp, deep: +(slp * 0.2).toFixed(2), rem: +(slp * 0.24).toFixed(2), awake: 24, score: Math.round(70 + 25 * w), resp: 15.1, bed: 23.2, wake: 7.1,
      strain: +(6 + 12 * Math.abs(Math.sin(i * 0.9))).toFixed(1), kcal: Math.round(2300 + 600 * Math.abs(Math.sin(i * 0.9))) };
    for (const [k, v] of Object.entries(m)) L.push(`INSERT OR REPLACE INTO daily_metrics VALUES (${q(day(i))},${q(k)},'whoop',${v},${now});`);
    const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
    if (i % 2 === 0 && i < 30) {
      const run = i % 4 === 0;
      const a = { id: "w" + uuid(i), wid: uuid(i), src: "whoop", date: day(i), start: "07:31", type: run ? "running" : "cycling", name: "", km: null, min: null, hr: 148, maxHr: 171, kcal: 640, strain: +(9 + (i % 5)).toFixed(1), z: [60, 900, 1300, 500, 60], te: null, teAn: null, load: null, label: null };
      // Dauer wie die Einheit der Uhr: folgt unten per UPDATE, wenn alle Einheiten angelegt sind
      L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route_done, updated_at) VALUES ('whoop', ${q(a.id)}, ${q(a.date)}, ${q(a.type)}, ${q(JSON.stringify(a))}, 1, 1, ${now});`);
      LAPS.push(`UPDATE activities SET data = json_set(data, '$.min', (SELECT json_extract(data, '$.min') FROM activities WHERE source = 'demo' AND external_id = ${q("demo" + i)})) WHERE source = 'whoop' AND external_id = ${q(a.id)};`);
    }
    if (i % 7 === 3) {
      const a = { id: "w" + uuid(500 + i), wid: uuid(500 + i), src: "whoop", date: day(i), start: "18:15", type: "yoga", name: "", km: null, min: 45, hr: 96, maxHr: 121, kcal: 160, strain: 4.2, z: [1800, 900, 0, 0, 0], te: null, teAn: null, load: null, label: null };
      L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route_done, updated_at) VALUES ('whoop', ${q(a.id)}, ${q(a.date)}, 'yoga', ${q(JSON.stringify(a))}, 1, 1, ${now});`);
    }
  }
  // Für Screenshots „verbunden“ zeigen: ausgedachte App und Tokens, verschlüsselt wie in der App (src/util.ts) mit dem
  // lokalen SESSION_SECRET aus .dev.vars. Keine echten Zugangsdaten; Abrufe bei WHOOP schlagen lokal einfach fehl.
  const secret = (readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^SESSION_SECRET=(.*)$/m) || [])[1];
  if (secret) {
    const { webcrypto } = await import("node:crypto");
    const b64u = (b) => Buffer.from(b).toString("base64url");
    const key = await webcrypto.subtle.importKey("raw", await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(secret.trim() + ":garmin-key")), "AES-GCM", false, ["encrypt"]);
    const enc = async (o) => { const iv = webcrypto.getRandomValues(new Uint8Array(12)); return b64u(iv) + "." + b64u(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(o)))); };
    L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('whoopApp', ${q(await enc({ id: "demo-client-id", secret: "demo-client-secret-0000" }))});`);
    L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('whoopTokens', ${q(await enc({ access: "demo", refresh: "demo", expires: Date.now() + 3600e3, user: "1", name: "Demo Person" }))});`);
  }
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('whoopMeta', ${q(JSON.stringify({ lastOk: new Date().toISOString(), lastSleep: new Date(Date.now() - 3 * 3600000).toISOString(), complete: true, count: 22 }))});`);
}
// Google Health / Fitbit, nur mit DEMO_GOOGLE=1: ausgedachte Nächte, HRV, Ruhepuls, Schritte der letzten 60 Tage und ein paar
// Fitbit-Einheiten (Gehen und HIIT am Abend, eigenständig). Verbindung im „Testmodus“, die in
// 2 Tagen abläuft, damit der Hinweis sichtbar ist. Ohne rnd, damit der Rest gleich bleibt.
L.push("DELETE FROM daily_metrics WHERE source = 'google';", "DELETE FROM activities WHERE source = 'google';", "DELETE FROM kv WHERE key IN ('googleApp', 'googleTokens', 'googleMeta', 'googleExpired');");
if (process.env.DEMO_GOOGLE === "1") {
  for (let i = 0; i < 60; i++) {
    const w = 0.5 + 0.5 * Math.sin(i * 1.1) * Math.cos(i / 6);
    const slp = +(6.2 + 1.7 * w).toFixed(2);
    const m = { hrv: Math.round(34 + 14 * w), rhr: Math.round(58 - 5 * w), spo2: 95.6, resp: 14.4, skinT: +(33.8 + 0.2 * Math.sin(i)).toFixed(1),
      slp, deep: +(slp * 0.17).toFixed(2), rem: +(slp * 0.21).toFixed(2), awake: 38, bed: 23.4, wake: 6.9, steps: Math.round(6500 + 5000 * w) };
    for (const [k, v] of Object.entries(m)) L.push(`INSERT OR REPLACE INTO daily_metrics VALUES (${q(day(i))},${q(k)},'google',${v},${now});`);
    if (i % 5 === 1 && i < 40) {
      const a = { id: "gdemo" + i, gid: "demo" + i, src: "google", date: day(i), start: "18:10", type: i % 10 === 1 ? "hiit" : "walking", name: "", km: i % 10 === 1 ? null : 4.2, min: 42, minTotal: 44, hr: 118, elev: 12, kcal: 290, steps: 5200, vo2: null, gz: [18, 14, 6, 0], azm: 26, te: null, teAn: null, load: null, label: null };
      L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route_done, updated_at) VALUES ('google', ${q(a.id)}, ${q(a.date)}, ${q(a.type)}, ${q(JSON.stringify(a))}, 1, 1, ${now});`);
    }
  }
  const secret = (readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^SESSION_SECRET=(.*)$/m) || [])[1];
  if (secret) {
    const { webcrypto } = await import("node:crypto");
    const b64u = (b) => Buffer.from(b).toString("base64url");
    const key = await webcrypto.subtle.importKey("raw", await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(secret.trim() + ":garmin-key")), "AES-GCM", false, ["encrypt"]);
    const enc = async (o) => { const iv = webcrypto.getRandomValues(new Uint8Array(12)); return b64u(iv) + "." + b64u(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(o)))); };
    L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('googleApp', ${q(await enc({ id: "demo-0000000000000000.apps.googleusercontent.com", secret: "demo-client-secret-0000" }))});`);
    L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('googleTokens', ${q(await enc({ access: "demo", refresh: "demo", expires: Date.now() + 3600e3, refreshExpires: Date.now() + 2.5 * 864e5, scope: ["sleep", "activity_and_fitness", "health_metrics_and_measurements"].map((x) => "https://www.googleapis.com/auth/googlehealth." + x + ".readonly").join(" ") }))});`);
  }
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('googleMeta', ${q(JSON.stringify({ lastOk: new Date().toISOString(), lastSleep: new Date(Date.now() - 5 * 3600000).toISOString(), complete: true, count: 8 }))});`);
}
L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('meta', ${q(JSON.stringify({ lastRun: new Date(Date.now() - 12 * 60000).toISOString(), lastRecent: new Date().toISOString(), complete: true, oldest: day(119), lapsPending: 0 }))});`);
// Wetter je Einheit (#54), ausgedacht und für alle Demo-Einheiten gleich (ohne rnd, damit die übrigen Demodaten gleich bleiben)
LAPS.push(`UPDATE activities SET weather = ${q(JSON.stringify({ t: 11.4, ta: 9.6, hu: 72, ws: 14, wd: 300, c: 3 }))} WHERE source = 'demo';`);

// ---------- Rad-Wetter (#153): ausgedachte Vorhersage, Orte, Fenster-Protokoll, Rückmeldungen ----------
// Ohne rnd, damit die übrigen Demodaten gleich bleiben. Rechnet mit src/radwetter.ts (deshalb --experimental-strip-types).
// Die Vorhersage ist als Demo markiert (demo: true) und wird nicht von Open-Meteo überschrieben, solange die Orte bleiben.
{
  const rw = await import("../src/radwetter.ts");
  const tz = "Europe/Berlin", nowS = Math.floor(Date.now() / 1000), off = rw.tzOffset(tz, nowS);
  const midnight = Math.floor((nowS + off) / 86400) * 86400 - off; // heute 00:00 Ortszeit
  // Tagesverlauf: tiefster Wert gegen 6 Uhr, höchster am Nachmittag
  const curve = (h, lo, hi) => lo + (hi - lo) * Math.max(0, Math.sin(Math.PI * (h - 6) / 16));
  // Wetterlagen im Wechsel, damit in jeden 48-Stunden-Ausschnitt kühl/windig, warm/trocken und nass fallen
  const KINDS = ["regenDannWind", "warm", "nass", "kuehl"];
  const story = (H, dt, wk) => {
    const day = Math.floor(H / 24), h = ((H % 24) + 24) % 24, kind = KINDS[((day % 4) + 4) % 4];
    const lightH = h >= 8 && h < 16;
    let o;
    if (day < 0) o = { t: curve(h, 5, 9), d: 3.5, rh: 85, p: h >= 17 ? 0.8 : 0, pp: h >= 17 ? 80 : 20, c: h >= 17 ? 61 : 3, cc: 90, ws: 18, wg: 34, wd: 290, sun: 0 };
    else if (kind === "regenDannWind") {
      const rain = h < 10;
      o = { t: curve(h, 9, 14), d: 3, rh: rain ? 95 : 75, p: rain ? (h >= 3 && h <= 7 ? 1.2 : 0.5) : 0, pp: rain ? 90 : h < 13 ? 25 : 10, c: rain ? 63 : 2, cc: rain ? 100 : 40,
        ws: h >= 8 && h <= 11 ? 27 : h <= 16 ? 22 : 14, wg: h >= 8 && h <= 11 ? 48 : 36, wd: 270, sun: lightH && !rain ? 2400 : 0 };
    } else if (kind === "warm") o = { t: curve(h, 9, 19), d: 0.8, rh: 55, p: 0, pp: 0, c: lightH ? 0 : 1, cc: 10, ws: 10, wg: 22, wd: 180, sun: lightH ? 3300 : 0 };
    else if (kind === "nass") o = { t: curve(h, 9, 12), d: 2.5, rh: 96, p: h % 5 === 0 ? 0.4 : 1.4, pp: 85, c: h % 3 ? 63 : 80, cc: 100, ws: 20, wg: 40, wd: 225, sun: 0 };
    else o = { t: curve(h, 4, 9), d: 3.5, rh: 80, p: 0, pp: 10, c: 3, cc: 85, ws: 22, wg: 42, wd: 315, sun: lightH ? 300 : 0 };
    return { t: +(o.t + dt).toFixed(1), ta: +(o.t + dt - o.d).toFixed(1), rh: o.rh, p: o.p, pp: o.pp, c: o.c, cc: o.cc, ws: Math.round(o.ws * wk), wg: Math.round(o.wg * wk), wd: o.wd, sun: o.sun };
  };
  const fcJson = (dt, wk) => {
    const time = Array.from({ length: 5 * 24 + 1 }, (_, i) => midnight - 86400 + i * 3600);
    const vals = time.map((e) => story(Math.round((e - midnight) / 3600), dt, wk));
    const col = (k) => vals.map((v) => v[k]);
    return {
      timezone: tz, utc_offset_seconds: off,
      hourly: { time, temperature_2m: col("t"), apparent_temperature: col("ta"), relative_humidity_2m: col("rh"), precipitation: col("p"), precipitation_probability: col("pp"),
        weather_code: col("c"), cloud_cover: col("cc"), wind_speed_10m: col("ws"), wind_gusts_10m: col("wg"), wind_direction_10m: col("wd"), is_day: time.map(() => 0), sunshine_duration: col("sun") },
      daily: { sunrise: [-1, 0, 1, 2, 3].map((d) => midnight + d * 86400 + 7.67 * 3600), sunset: [-1, 0, 1, 2, 3].map((d) => midnight + d * 86400 + 16.08 * 3600) },
    };
  };
  // Zwei ausgedachte Lieblingsrunden: nach Südosten hin und zurück, Schleife im Südwesten
  const line = (from, bearingDeg, km, n) => Array.from({ length: n + 1 }, (_, i) => {
    const d = (km * i) / n, a = (bearingDeg * Math.PI) / 180;
    return [+(from[0] + (d * Math.cos(a)) / 111).toFixed(5), +(from[1] + (d * Math.sin(a)) / (111 * Math.cos((from[0] * Math.PI) / 180))).toFixed(5)];
  });
  const start = [52.4735, 13.4015];
  const out = line(start, 135, 34, 60), wiggle = (p, i) => [+(p[0] + Math.sin(i / 3) * 0.004).toFixed(5), p[1]];
  const spreewald = [...out.map(wiggle), ...out.slice(0, -1).reverse()];
  const grunewald = Array.from({ length: 121 }, (_, i) => {
    const t = (i / 120) * 2 * Math.PI, rKm = 7.5, cLat = 52.43, cLon = 13.27;
    return [+(cLat + (rKm * Math.sin(t) * (1 + 0.15 * Math.cos(3 * t))) / 111).toFixed(5), +(cLon + (rKm * Math.cos(t) * 1.3) / (111 * Math.cos((cLat * Math.PI) / 180))).toFixed(5)];
  });
  grunewald.unshift(start); grunewald.push(start);
  const extra = [
    { id: "demo-rw1", i: 9, start: "09:10", name: "Spreewald hin und zurück", route: spreewald, wx: { t: 6.5, ta: 3.1, hu: 81, ws: 26, wd: 300, c: 3 } },
    { id: "demo-rw2", i: 13, start: "10:30", name: "Grunewald-Schleife", route: grunewald, wx: { t: 13.2, ta: 12.1, hu: 64, ws: 11, wd: 200, c: 0 } },
  ];
  for (const x of extra) {
    const info = rw.routeInfo(x.route), km = info.km, min = Math.round((km / 27.5) * 60);
    const a = { id: x.id, date: day(x.i), start: x.start, type: "road_biking", name: x.name, km, min, hr: 138, maxHr: 166, spd: +(km / min / 0.06).toFixed(3), pw: 196, elev: 140, te: 3.1, teAn: 0.6, load: 120, label: "AEROBIC_BASE", z: [300, 2400, 1200, 300, 0], kcal: Math.round(min * 9) };
    L.push(`INSERT OR REPLACE INTO activities (source, external_id, day, type, data, laps_done, route, route_done, updated_at) VALUES ('demo', ${q(x.id)}, ${q(a.date)}, 'road_biking', ${q(JSON.stringify(a))}, 1, ${q(JSON.stringify(x.route))}, 1, ${now});`);
    LAPS.push(`UPDATE activities SET weather = ${q(JSON.stringify(x.wx))} WHERE source = 'demo' AND external_id = ${q(x.id)};`);
  }
  // Wetter je Einheit für die Radfahrten: Regen, Kälte, Wind und Sonne im Wechsel (für Abzeichen und Rekorde)
  const WX = [{ t: 9.1, ta: 6.4, hu: 94, ws: 18, wd: 230, c: 61 }, { t: 1.2, ta: -2.3, hu: 80, ws: 12, wd: 40, c: 3 }, { t: 10.4, ta: 6.0, hu: 70, ws: 31, wd: 280, c: 2 }, { t: 14.6, ta: 14.0, hu: 58, ws: 9, wd: 160, c: 0 }];
  for (let i = 2; i < 120; i += 4) LAPS.push(`UPDATE activities SET weather = ${q(JSON.stringify(WX[((i - 2) / 4) % 4]))} WHERE source = 'demo' AND external_id = ${q("demo" + i)};`);
  const places = [
    { id: "home", kind: "home", name: "Zuhause", lat: 52.47, lng: 13.4 },
    ...extra.map((x, k) => { const info = rw.routeInfo(x.route); return { id: "rdemo" + k, kind: "route", name: x.name, lat: info.c[0], lng: info.c[1], act: x.id, km: info.km, bear: info.bear, spread: info.spread, sk: info.sk, hi: info.hi }; }),
  ];
  const list = {};
  places.forEach((p, k) => { const fc = rw.parseForecast(fcJson([0, 0.6, -0.4][k], [1, 1.15, 0.9][k])); list[p.id] = { tz, h: rw.packHours(fc.hours) }; });
  const key = places.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|");
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('rwCfg', ${q(JSON.stringify({ on: true, places, game: true, goal: 2, push: { place: null, announce: true, remind: 30 } }))});`);
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('rwFc', ${q(JSON.stringify({ at: Date.now(), key, demo: true, list }))});`);
  // Protokoll: 8 Wochen Fenster. An Fahrttagen (alle 4 Tage, Start 7:30) meist morgens, vor 6 Wochen nie passend (Serie reißt)
  const lg = {};
  for (let i = 56; i >= 1; i--) {
    const d = day(i), ride = i % 4 === 2;
    if (i % 7 === 5) continue; // ab und zu ein Tag ganz ohne Fenster
    lg[d] = { w: ride && !(i >= 38 && i <= 44) ? [[7, 12, i % 8 === 2 ? 91 : 74]] : [[12, 15, 68]] };
  }
  const home = rw.parseForecast(fcJson(0, 1));
  const fresh = rw.logDays(home.hours, rw.findWindows(home.hours, rw.rateHours(home.hours, rw.DEFAULT_CRIT), rw.DEFAULT_CRIT));
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('rwLog', ${q(JSON.stringify(rw.mergeLog(lg, fresh)))});`);
  // Rückmeldungen: einmal zu kalt, sonst passt; die Fahrt von vorgestern wartet noch auf eine Rückmeldung
  const fb = [[22, 0], [18, -1], [14, 0], [10, 0], [6, 0]].map(([i, v], k) => ({ id: "demo" + i, d: day(i), v, f: [6.1, 3.4, 7.9, 5.2, 4.4][k], lvl: "ll", at: Date.now() - i * 864e5 }));
  L.push(`INSERT OR REPLACE INTO kv (key, value) VALUES ('rwFb', ${q(JSON.stringify({ list: fb }))});`);
  L.push("DELETE FROM kv WHERE key = 'rwPush';");
}
writeFileSync(new URL("./.demo-seed.sql", import.meta.url), [...L, ...LAPS].join("\n"));
console.log(`Demo-SQL mit ${L.length} Zeilen geschrieben.`);
