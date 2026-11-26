// Google Health API (Fitbit, Pixel Watch, Fitbit Air) -> Tageswerte und Einheiten. Reine Funktionen, getestet in
// test/google.test.ts. Feldnamen aus der Referenz developers.google.com/health/reference/rest (v4), noch ungetestet
// mit echtem Konto. Bewusst ohne Importe mit Laufzeit-Code, damit die Tests die Datei direkt laden können.
//
// Metriken (Feldnamen der Oberfläche, source = 'google'):
//   hrv ms (RMSSD im Schlaf) · rhr bpm · spo2 % · resp Atemzüge/min · skinT Hauttemperatur im Schlaf °C
//   slp/deep/rem h · awake min · bed/wake Uhrzeit in h · steps · kg · fat %
// Kein Schlafscore (liefert die API nicht) und keine Garmin-artige Trainingswirkung.
//
// Zeiten: Laut Doku liefert die API zu jedem Zeitpunkt die Ortszeit („civil“) mit. Echte Antworten (Fitbit Air, Feedback #8)
// haben bei Schlaf und Trainings aber nur Weltzeit + Zeitunterschied (startTime, startUtcOffset). Dann rechnet `localAt` die
// Ortszeit selbst aus. Tage kommen aus der Ortszeit,
// Schlaf zählt (wie bei Garmin und WHOOP) zum Tag des Aufwachens.
import type { MetricRow } from "../garmin/extract";

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Zahl aus number oder int64-Text („42“); sonst null */
const n = (v: unknown): number | null => {
  const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) ? x : null;
};
const round = (v: number | null, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const pad = (x: number) => String(x).padStart(2, "0");

/** Liste aus einer list-Antwort ({dataPoints: […], nextPageToken}) */
export const dataPoints = (body: unknown): Obj[] => (isObj(body) && Array.isArray(body.dataPoints) ? body.dataPoints.filter(isObj) : []);

/** google.type.Date {year, month, day} → „JJJJ-MM-TT“ */
export function ymd(d: unknown): string | null {
  if (!isObj(d)) return null;
  const y = n(d.year), m = n(d.month), t = n(d.day);
  return y && m && t ? `${y}-${pad(m)}-${pad(t)}` : null;
}
/** CivilDateTime {date, time: {hours, minutes}} → „JJJJ-MM-TTTHH:MM“ (fehlende Uhrzeit = Mitternacht) */
export function civil(c: unknown): string | null {
  if (!isObj(c)) return null;
  const day = ymd(c.date);
  if (!day) return null;
  const t = isObj(c.time) ? c.time : {};
  return `${day}T${pad(n(t.hours) ?? 0)}:${pad(n(t.minutes) ?? 0)}`;
}
/** Dauer „123.5s“ → Sekunden */
export const seconds = (d: unknown): number | null => (typeof d === "string" && /^-?\d+(\.\d+)?s$/.test(d) ? Number(d.slice(0, -1)) : null);
/** Ortszeit „JJJJ-MM-TTTHH:MM“: zuerst das civil-Feld, sonst Weltzeit + Zeitunterschied („3600s“). Ohne beides null. */
export function localAt(civilField: unknown, utc: unknown, offset: unknown): string | null {
  const c = civil(civilField);
  if (c) return c;
  const t = typeof utc === "string" ? Date.parse(utc) : NaN, off = seconds(offset);
  return isFinite(t) && off != null ? new Date(t + off * 1000).toISOString().slice(0, 16) : null;
}
/** Anfang bzw. Ende eines Intervalls ({startTime, startUtcOffset, civilStartTime, …}) in Ortszeit */
export const intervalAt = (iv: Obj, edge: "start" | "end"): string | null =>
  edge === "start" ? localAt(iv.civilStartTime, iv.startTime, iv.startUtcOffset) : localAt(iv.civilEndTime, iv.endTime, iv.endUtcOffset);
/** Messzeitpunkt (sampleTime {civilTime | physicalTime + utcOffset}) in Ortszeit */
const sampleAt = (st: unknown): string | null => (isObj(st) ? localAt(st.civilTime, st.physicalTime ?? st.time, st.utcOffset) : null);
const hours = (local: string, wrap: boolean) => {
  const h = Number(local.slice(11, 13)) + Number(local.slice(14, 16)) / 60;
  return Math.round((wrap && h < 12 ? h + 24 : h) * 100) / 100;
};

/** Datenpunkt-ID aus dem Namen „users/…/dataTypes/exercise/dataPoints/<id>“ */
export const pointId = (p: Obj): string | null => (typeof p.name === "string" ? p.name.split("/").pop() || null : null);

// ---------- Schlaf ----------
const STAGE_MIN = (summary: Obj, type: string) => {
  for (const s of Array.isArray(summary?.stagesSummary) ? summary.stagesSummary : []) if (s?.type === type) return n(s.minutes);
  return null;
};
/** Hauptschlaf je Aufwachtag (ohne Nickerchen; bei mehreren der längste) */
export function extractSleep(body: unknown): MetricRow[] {
  const best = new Map<string, { asleep: number; s: Obj; start: string; end: string }>();
  for (const p of dataPoints(body)) {
    const s = p.sleep;
    if (!isObj(s) || !isObj(s.interval)) continue;
    if (s.metadata?.nap === true) continue;
    const start = intervalAt(s.interval, "start"), end = intervalAt(s.interval, "end");
    const asleep = n(s.summary?.minutesAsleep);
    if (!start || !end || !asleep) continue;
    const day = end.slice(0, 10), prev = best.get(day);
    // Hauptschlaf hat Vorrang, sonst der längste
    const main = s.metadata?.mainSleep === true;
    if (!prev || (main && prev.s.metadata?.mainSleep !== true) || (main === (prev.s.metadata?.mainSleep === true) && asleep > prev.asleep)) {
      best.set(day, { asleep, s, start, end });
    }
  }
  const rows: MetricRow[] = [];
  const push = (day: string, metric: string, v: number | null) => { if (v != null && isFinite(v)) rows.push({ day, metric, value: v }); };
  for (const [day, { asleep, s, start, end }] of best) {
    const sum = s.summary || {};
    const stages = s.type === "STAGES" || s.metadata?.stagesStatus === "SUCCEEDED";
    push(day, "slp", round(asleep / 60, 2));
    if (stages) {
      push(day, "deep", round((STAGE_MIN(sum, "DEEP") ?? NaN) / 60, 2));
      push(day, "rem", round((STAGE_MIN(sum, "REM") ?? NaN) / 60, 2));
    }
    push(day, "awake", n(sum.minutesAwake));
    push(day, "bed", hours(start, true));
    push(day, "wake", hours(end, false));
  }
  return rows;
}

// ---------- Tageswerte ----------
/** Tageswert-Typen der API → [Feld im Datenpunkt, Wertfeld, Metrik, Nachkommastellen] */
export const DAILY: Record<string, [string, string, string, number]> = {
  "daily-heart-rate-variability": ["dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds", "hrv", 0],
  "daily-resting-heart-rate": ["dailyRestingHeartRate", "beatsPerMinute", "rhr", 0],
  "daily-oxygen-saturation": ["dailyOxygenSaturation", "averagePercentage", "spo2", 1],
  "daily-respiratory-rate": ["dailyRespiratoryRate", "breathsPerMinute", "resp", 1],
  "daily-sleep-temperature-derivations": ["dailySleepTemperatureDerivations", "nightlyTemperatureCelsius", "skinT", 1],
};
export function extractDaily(type: string, body: unknown): MetricRow[] {
  const def = DAILY[type];
  if (!def) return [];
  const [field, value, metric, d] = def;
  const rows: MetricRow[] = [];
  for (const p of dataPoints(body)) {
    const x = p[field];
    const day = isObj(x) ? ymd(x.date) : null;
    const v = isObj(x) ? round(n(x[value]), d) : null;
    if (day && v != null) rows.push({ day, metric, value: v });
  }
  return rows;
}

/** Gewicht und Körperfett (Waage oder manuell): pro Tag die letzte Messung */
export function extractBody(body: unknown): MetricRow[] {
  const last = new Map<string, { t: string; metric: string; value: number }>();
  for (const p of dataPoints(body)) {
    const w = isObj(p.weight) ? p.weight : null, f = isObj(p.bodyFat) ? p.bodyFat : null;
    const x = w || f;
    const t = x ? sampleAt(x.sampleTime) : null;
    if (!x || !t) continue;
    const metric = w ? "kg" : "fat";
    const value = w ? round((n(w.weightGrams) ?? NaN) / 1000, 2) : round(n(f!.percentage), 1);
    if (value == null || !isFinite(value)) continue;
    const key = t.slice(0, 10) + "|" + metric, prev = last.get(key);
    if (!prev || t > prev.t) last.set(key, { t, metric, value });
  }
  return [...last.entries()].map(([k, v]) => ({ day: k.slice(0, 10), metric: v.metric, value: v.value }));
}

/** Schritte je Tag aus dailyRollUp (rollupDataPoints[].steps). Feldname laut Doku-Schema {Feld}_{Funktion}, also countSum. */
export function extractSteps(body: unknown): MetricRow[] {
  const list = isObj(body) && Array.isArray(body.rollupDataPoints) ? body.rollupDataPoints.filter(isObj) : [];
  const rows: MetricRow[] = [];
  for (const r of list) {
    const day = localAt(r.civilStartTime, r.startTime, r.startUtcOffset)?.slice(0, 10);
    const v = isObj(r.steps) ? n(r.steps.countSum ?? r.steps.count) : null;
    if (day && v != null) rows.push({ day, metric: "steps", value: Math.round(v) });
  }
  return rows;
}

// ---------- Einheiten ----------
/** Google-Sportart → Garmin-artiger Typ, damit Symbole, Farben und Auswertungen gleich funktionieren */
const SPORT: Record<string, string> = {
  RUNNING: "running", TRAIL_RUN: "trail_running", TREADMILL: "treadmill_running", INCLINE_RUN: "treadmill_running",
  WALKING: "walking", POWER_WALKING: "walking", TREADMILL_WALK: "walking", INCLINE_WALK: "walking", NORDIC_WALKING: "walking",
  HIKING: "hiking", BACKPACKING: "hiking", RUCKING: "hiking",
  BIKING: "cycling", OUTDOOR_BIKE: "road_biking", MOUNTAIN_BIKE: "mountain_biking", ELECTRIC_BIKE: "e_bike_fitness",
  STATIONARY_BIKE: "indoor_cycling", SPINNING: "indoor_cycling", ASSAULT_BIKE: "indoor_cycling",
  SWIMMING: "lap_swimming", SWIMMING_POOL: "lap_swimming", SWIMMING_OPEN_WATER: "open_water_swimming",
  STRENGTH_TRAINING: "strength_training", WEIGHTLIFTING: "strength_training", WEIGHTS: "strength_training",
  FREE_WEIGHTS: "strength_training", WEIGHT_MACHINES: "strength_training", POWERLIFTING: "strength_training",
  FUNCTIONAL_STRENGTH_TRAINING: "strength_training", BODY_WEIGHT: "strength_training", CALISTHENICS: "strength_training",
  HIIT: "hiit", INTERVAL_WORKOUT: "hiit", TABATA_WORKOUT: "hiit", CROSSFIT: "hiit", CIRCUIT_TRAINING: "hiit",
  YOGA: "yoga", YOGA_BIKRAM: "yoga", YOGA_HATHA: "yoga", YOGA_POWER: "yoga", YOGA_VINYASA: "yoga", PILATES: "pilates",
  ROWING: "rowing", ROWING_MACHINE: "indoor_rowing", ELLIPTICAL: "elliptical", STAIRCLIMBER: "stair_climbing",
  SKIING: "resort_skiing", CROSS_COUNTRY_SKI: "cross_country_skiing", SNOWBOARDING: "resort_snowboarding",
};
export const googleType = (t: unknown) => {
  const k = typeof t === "string" ? t.toUpperCase() : "";
  return SPORT[k] || (k && k !== "EXERCISE_TYPE_UNSPECIFIED" ? k.toLowerCase() : "other");
};

/** Einheit für die Oberfläche. `id` mit „g“ davor, damit sie nie mit einer anderen Quelle zusammenfällt. */
export function normalizeExercise(p: Obj): Obj | null {
  const id = pointId(p), e = p.exercise;
  if (!id || !isObj(e) || !isObj(e.interval)) return null;
  const start = intervalAt(e.interval, "start");
  const t0 = Date.parse(e.interval.startTime), t1 = Date.parse(e.interval.endTime);
  if (!start) return null;
  const m = isObj(e.metricsSummary) ? e.metricsSummary : {};
  const active = seconds(e.activeDuration);
  const total = isFinite(t0) && isFinite(t1) && t1 > t0 ? (t1 - t0) / 1000 : null;
  const z = isObj(m.heartRateZoneDurations) ? m.heartRateZoneDurations : {};
  const mm = (v: unknown, div: number, d: number) => { const x = n(v); return x == null ? null : round(x / div, d); };
  const type = googleType(e.exerciseType);
  return {
    id: "g" + id,
    gid: id,
    src: "google",
    date: start.slice(0, 10),
    start: start.slice(11, 16),
    type,
    name: e.exerciseType === "OTHER" && typeof e.displayName === "string" ? e.displayName : "",
    km: mm(m.distanceMillimeters, 1e6, 2) || null,
    min: round((active ?? total ?? NaN) / 60, 1),
    minTotal: total != null ? round(total / 60, 1) : null,
    hr: n(m.averageHeartRateBeatsPerMinute),
    elev: mm(m.elevationGainMillimeters, 1000, 0),
    kcal: round(n(m.caloriesKcal), 0),
    steps: n(m.steps),
    vo2: round(n(m.runVo2Max), 1),
    // Fitbit-Zonen (leicht, mittel, intensiv, Spitze) passen nicht auf Garmins fünf Zonen: eigenes Feld, in Minuten
    gz: [z.lightTime, z.moderateTime, z.vigorousTime, z.peakTime].map((d) => Math.round((seconds(d) ?? 0) / 60)),
    azm: n(m.activeZoneMinutes),
    // Keine Route, Runden, Verläufe oder Garmin-Trainingswirkung
    te: null, teAn: null, load: null, label: null,
  };
}

const sportClass = (type: string) => (/run|walk|hik/.test(type) ? "foot" : /bik|cycl|ride|spin/.test(type) ? "bike" : /swim/.test(type) ? "swim" : null);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Gleiche Einheit wie von der Uhr? Gleicher Tag, Start ± 5 Min., Dauer ± 25 %, Sportart passend (wie bei WHOOP). */
export function sameExercise(a: Obj, g: Obj): boolean {
  if (a.date !== g.date || !a.start || !g.start) return false;
  if (Math.abs(minutesOf(a.start) - minutesOf(g.start)) > 5) return false;
  const ca = sportClass(a.type || ""), cg = sportClass(g.type || "");
  if (ca && cg && ca !== cg) return false;
  const x = a.minTotal || a.min || 0, y = g.minTotal || g.min || 0;
  return !x || !y || Math.abs(x - y) <= 0.25 * Math.max(x, y);
}

/**
 * Doppelte Einheiten (Garmin-Uhr und Fitbit gleichzeitig): Garmin bleibt, Google hängt als `google` daran.
 * Einheiten nur bei Google Health bleiben eigenständig.
 */
export function mergeGoogle(acts: Obj[]): Obj[] {
  const garmin = acts.filter((a) => a.src === "garmin");
  const out = acts.filter((a) => a.src !== "google");
  for (const g of acts.filter((a) => a.src === "google")) {
    const a = garmin.find((x) => !x.google && sameExercise(x, g));
    if (!a) { out.push(g); continue; }
    a.google = { gid: g.gid, kcal: g.kcal, azm: g.azm, hr: g.hr };
  }
  return out;
}
