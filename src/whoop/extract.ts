// WHOOP-Antworten (API v2) -> Tageswerte und Einheiten. Reine Funktionen, getestet in test/whoop.test.ts.
// Feldnamen aus der WHOOP-Doku (developer.whoop.com), noch ungetestet mit echtem Konto.
// Bewusst ohne Importe mit Laufzeit-Code, damit die Tests die Datei direkt laden können.
//
// Metriken (Feldnamen der Oberfläche, source = 'whoop'):
//   rec Recovery 0–100 % (neu) · hrv ms (RMSSD) · rhr bpm · spo2 % · skinT Hauttemperatur °C (neu)
//   slp/deep/rem h · awake min · score Schlafleistung 0–100 % · resp Atemzüge/min · bed/wake Uhrzeit in h
//   strain Day Strain 0–21 (neu) · kcal Tagesumsatz laut WHOOP
//
// Tageszuordnung: WHOOP denkt in „Cycles“ (Einschlafen bis Einschlafen). Schlaf und Recovery gehören zum Tag des
// Aufwachens (wie bei Garmin), Strain und kcal eines Cycles ebenfalls zu diesem Tag. Nickerchen zählen nicht zur Nacht.
import type { MetricRow } from "../garmin/extract";

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, n = 1): number | null => (typeof v === "number" && isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null);
const KJ_PER_KCAL = 4.184;

/** Liste aus einer Sammel-Antwort ({records: […], next_token}) */
export const records = (body: unknown): Obj[] => (isObj(body) && Array.isArray(body.records) ? body.records.filter(isObj) : []);

/** Versatz „+01:00“ / „-05:30“ / „Z“ → Minuten; unbekannt = null */
export function offsetMinutes(off: unknown): number | null {
  if (off === "Z") return 0;
  const m = typeof off === "string" ? /^([+-])(\d{2}):?(\d{2})$/.exec(off) : null;
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

/** Zeitpunkt in Ortszeit als „JJJJ-MM-TTTHH:MM“. Ohne WHOOP-Versatz über die Zeitzone `tz`. */
export function localTime(isoUtc: unknown, offset: unknown, tz = "Europe/Berlin"): string | null {
  const t = typeof isoUtc === "string" ? Date.parse(isoUtc) : NaN;
  if (!isFinite(t)) return null;
  const off = offsetMinutes(offset);
  if (off != null) return new Date(t + off * 60000).toISOString().slice(0, 16);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return new Date(t).toISOString().slice(0, 16);
  }
}
/** Uhrzeit in Stunden; `wrap`: vor 12 Uhr + 24 (Zubettgehen nach Mitternacht, wie bei Garmin) */
const hours = (local: string, wrap: boolean) => {
  const h = Number(local.slice(11, 13)) + Number(local.slice(14, 16)) / 60;
  return Math.round((wrap && h < 12 ? h + 24 : h) * 100) / 100;
};
/** Tag, zu dem ein Cycle gehört: Er beginnt mit dem Einschlafen, also zählt der Tag nach der Nacht (Start + 12 h) */
export function cycleDay(start: unknown, offset: unknown, tz = "Europe/Berlin"): string | null {
  const t = typeof start === "string" ? Date.parse(start) : NaN;
  return isFinite(t) ? localTime(new Date(t + 12 * 3600000).toISOString(), offset, tz)?.slice(0, 10) ?? null : null;
}

const scored = (x: Obj) => x.score_state === "SCORED" && isObj(x.score);

/** Hauptschlaf je Tag des Aufwachens (längster, ohne Nickerchen). Liefert auch Schlaf-ID → Tag für die Recovery. */
export function extractSleeps(body: unknown, tz = "Europe/Berlin"): { rows: MetricRow[]; dayOf: Record<string, string> } {
  const best = new Map<string, { asleep: number; s: Obj; start: string; end: string }>();
  const dayOf: Record<string, string> = {};
  for (const s of records(body)) {
    if (s.nap === true || !scored(s) || typeof s.id !== "string") continue;
    const start = localTime(s.start, s.timezone_offset, tz), end = localTime(s.end, s.timezone_offset, tz);
    if (!start || !end) continue;
    const st = isObj(s.score.stage_summary) ? s.score.stage_summary : {};
    const asleep = (st.total_light_sleep_time_milli || 0) + (st.total_slow_wave_sleep_time_milli || 0) + (st.total_rem_sleep_time_milli || 0);
    if (!asleep) continue;
    const day = end.slice(0, 10);
    dayOf[s.id] = day;
    const prev = best.get(day);
    if (!prev || asleep > prev.asleep) best.set(day, { asleep, s, start, end });
  }
  const rows: MetricRow[] = [];
  const push = (day: string, metric: string, v: number | null) => { if (v != null && isFinite(v)) rows.push({ day, metric, value: v }); };
  for (const [day, { asleep, s, start, end }] of best) {
    const st = s.score.stage_summary || {};
    push(day, "slp", num(asleep / 3600000, 2));
    push(day, "deep", num((st.total_slow_wave_sleep_time_milli ?? NaN) / 3600000, 2));
    push(day, "rem", num((st.total_rem_sleep_time_milli ?? NaN) / 3600000, 2));
    push(day, "awake", num((st.total_awake_time_milli ?? NaN) / 60000, 0));
    push(day, "score", num(s.score.sleep_performance_percentage, 0));
    push(day, "resp", num(s.score.respiratory_rate, 1));
    push(day, "bed", hours(start, true));
    push(day, "wake", hours(end, false));
  }
  return { rows, dayOf };
}

/**
 * Recovery → Tageswerte. Tag = Aufwachtag der zugehörigen Nacht (`sleepDay`: Schlaf-ID → Tag), sonst der Tag, an dem
 * WHOOP die Recovery berechnet hat (kurz nach dem Aufwachen).
 */
export function extractRecoveries(body: unknown, sleepDay: Record<string, string> = {}, tz = "Europe/Berlin"): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const r of records(body)) {
    if (!scored(r)) continue;
    const day = (typeof r.sleep_id === "string" && sleepDay[r.sleep_id]) || localTime(r.created_at, null, tz)?.slice(0, 10);
    if (!day) continue;
    const push = (metric: string, v: number | null) => { if (v != null) rows.push({ day, metric, value: v }); };
    push("rec", num(r.score.recovery_score, 0));
    push("hrv", num(r.score.hrv_rmssd_milli, 0));
    push("rhr", num(r.score.resting_heart_rate, 0));
    push("spo2", num(r.score.spo2_percentage, 1));
    push("skinT", num(r.score.skin_temp_celsius, 1));
  }
  return rows;
}

/** Cycle → Day Strain und Tagesumsatz. Der laufende Cycle (ohne Ende) wird bei jedem Abruf aktualisiert. */
export function extractCycles(body: unknown, tz = "Europe/Berlin"): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const c of records(body)) {
    if (!scored(c)) continue;
    const day = cycleDay(c.start, c.timezone_offset, tz);
    if (!day) continue;
    const strain = num(c.score.strain, 1), kj = num(c.score.kilojoule, 0);
    if (strain != null) rows.push({ day, metric: "strain", value: strain });
    if (kj != null) rows.push({ day, metric: "kcal", value: Math.round(kj / KJ_PER_KCAL) });
  }
  return rows;
}

/** WHOOP-Sportart (sport_name, v2) → Garmin-artiger Typ, damit Symbole, Farben und Auswertungen gleich funktionieren */
const SPORT: Record<string, string> = {
  running: "running", "track & field": "track_running", cycling: "cycling", "mountain biking": "mountain_biking",
  spin: "indoor_cycling", swimming: "lap_swimming", walking: "walking", hiking: "hiking", rowing: "rowing",
  weightlifting: "strength_training", "functional fitness": "fitness_equipment", "powerlifting": "strength_training",
  yoga: "yoga", pilates: "pilates", hiit: "hiit", skiing: "resort_skiing", "cross country skiing": "cross_country_skiing",
};
export const whoopType = (name: unknown) => {
  const n = typeof name === "string" ? name.trim().toLowerCase().replace(/[-_]+/g, " ") : "";
  return SPORT[n] || (n ? n.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other" : "other");
};

/** Einheit für die Oberfläche. `id` mit „w“ davor, damit sie nie mit einer Garmin- oder Strava-ID zusammenfällt. */
export function normalizeWorkout(w: Obj, tz = "Europe/Berlin"): Obj | null {
  if (typeof w?.id !== "string" || !w.id) return null;
  const start = localTime(w.start, w.timezone_offset, tz);
  const t0 = Date.parse(w.start), t1 = Date.parse(w.end);
  if (!start || !isFinite(t0)) return null;
  const sc = scored(w) ? w.score : {};
  const zd = isObj(sc.zone_durations) ? sc.zone_durations : {};
  const zone = (k: string) => (typeof zd[k] === "number" ? Math.round(zd[k] / 1000) : 0);
  const kj = num(sc.kilojoule, 0);
  return {
    id: "w" + w.id,
    wid: w.id,
    src: "whoop",
    date: start.slice(0, 10),
    start: start.slice(11, 16),
    type: whoopType(w.sport_name),
    name: "",
    km: typeof sc.distance_meter === "number" ? num(sc.distance_meter / 1000, 2) : null,
    min: isFinite(t1) && t1 > t0 ? num((t1 - t0) / 60000, 1) : null,
    hr: num(sc.average_heart_rate, 0),
    maxHr: num(sc.max_heart_rate, 0),
    elev: num(sc.altitude_gain_meter, 0),
    kcal: kj != null ? Math.round(kj / KJ_PER_KCAL) : null,
    strain: num(sc.strain, 1),
    // Sekunden je WHOOP-Pulszone 1–5 (WHOOP rechnet in % der maximalen Herzfrequenz, Zone 0 = darunter)
    z: ["zone_one_milli", "zone_two_milli", "zone_three_milli", "zone_four_milli", "zone_five_milli"].map(zone),
    // Keine GPS-Route, Runden oder Verläufe; kein Garmin-Trainingseffekt
    te: null, teAn: null, load: null, label: null,
  };
}

const sportClass = (type: string) => (/run|walk|hik/.test(type) ? "foot" : /bik|cycl|ride|spin/.test(type) ? "bike" : /swim/.test(type) ? "swim" : null);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Gleiche Einheit? Gleicher Tag, Start höchstens 5 Minuten auseinander, Dauer höchstens 25 % verschieden.
 * WHOOP liefert oft keine Distanz, deshalb über die Zeit; sind beide Sportarten bekannt, müssen sie passen.
 */
export function sameWorkout(a: Obj, w: Obj): boolean {
  if (a.date !== w.date || !a.start || !w.start) return false;
  if (Math.abs(minutes(a.start) - minutes(w.start)) > 5) return false;
  const ca = sportClass(a.type || ""), cw = sportClass(w.type || "");
  if (ca && cw && ca !== cw) return false;
  const x = a.minTotal || a.min || 0, y = w.min || 0;
  return !x || !y || Math.abs(x - y) <= 0.25 * Math.max(x, y);
}

/** Was WHOOP zu einer Garmin- oder Strava-Einheit beiträgt (die Messwerte selbst kommen von dort) */
export const WHOOP_EXTRAS = ["wid", "strain", "kcal", "hr", "maxHr"] as const;

/**
 * Doppelte Einheiten (Uhr + WHOOP-Band): Die andere Quelle bleibt (GPS, Runden), WHOOP hängt als `whoop` an der
 * Einheit. Einheiten nur bei WHOOP bleiben eigenständig.
 */
export function mergeWhoop(acts: Obj[]): Obj[] {
  const others = acts.filter((a) => a.src !== "whoop");
  const byDay = new Map<string, Obj[]>();
  for (const a of others) (byDay.get(a.date) ?? byDay.set(a.date, []).get(a.date)!).push(a);
  const out = [...others];
  for (const w of acts.filter((a) => a.src === "whoop")) {
    const a = (byDay.get(w.date) || []).find((x) => !x.whoop && sameWorkout(x, w));
    if (!a) { out.push(w); continue; }
    a.whoop = Object.fromEntries(WHOOP_EXTRAS.map((k) => [k, w[k]]));
  }
  return out;
}

/** Webhook-Signatur: Base64(HMAC-SHA256(Client-Secret, Zeitstempel-Header + Rohtext)) */
export async function webhookSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + body)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
