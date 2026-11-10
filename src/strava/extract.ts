// Strava-Aktivität → Einheit im Format der Oberfläche, plus Erkennung doppelter Einheiten (Garmin → Strava).
// Reine Funktionen, getestet in test/strava.test.ts. Nur Feldnamen aus der Strava-API-Doku.

type Obj = Record<string, any>;
const num = (v: unknown, n = 1): number | null => (typeof v === "number" && isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null);

/** Strava-Sportart → Garmin-artiger Typ, damit Symbole, Farben und Auswertungen gleich funktionieren */
const SPORT: Record<string, string> = {
  Run: "running", TrailRun: "trail_running", VirtualRun: "treadmill_running",
  Ride: "road_biking", GravelRide: "gravel_cycling", MountainBikeRide: "mountain_biking", VirtualRide: "virtual_ride",
  EBikeRide: "e_bike_fitness", EMountainBikeRide: "e_bike_mountain", Velomobile: "cycling", Handcycle: "hand_cycling",
  Swim: "lap_swimming", Walk: "walking", Hike: "hiking", WeightTraining: "strength_training", Workout: "fitness_equipment",
  Yoga: "yoga", Rowing: "rowing", VirtualRow: "indoor_rowing", NordicSki: "cross_country_skiing", AlpineSki: "resort_skiing",
};
export const stravaType = (sport: string | undefined) => (sport && SPORT[sport]) || (sport ? sport.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : "other");

/** Googles Polyline-Format → [[Breite, Länge], …] (5 Nachkommastellen) */
export function decodePolyline(s: string | null | undefined): Array<[number, number]> {
  if (!s) return [];
  const out: Array<[number, number]> = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < s.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** Einheit für die Oberfläche. `id` mit „s“ davor, damit sie nie mit einer Garmin-ID zusammenfällt. */
export function normalizeStrava(a: Obj): Obj | null {
  if (a?.id == null || typeof a.start_date_local !== "string") return null;
  const type = stravaType(a.sport_type || a.type);
  const run = /running|walking|hiking/.test(type);
  const watts = num(a.average_watts, 0);
  return {
    id: "s" + a.id,
    sid: String(a.id),
    src: "strava",
    date: a.start_date_local.slice(0, 10),
    start: a.start_date_local.slice(11, 16),
    type,
    name: a.name || "",
    km: num((a.distance || 0) / 1000, 2),
    min: num((a.moving_time || 0) / 60, 1),
    minTotal: num((a.elapsed_time || 0) / 60, 1),
    hr: num(a.average_heartrate, 0),
    maxHr: num(a.max_heartrate, 0),
    spd: num(a.average_speed, 3),
    maxSpd: num(a.max_speed, 3),
    // Strava zählt beim Laufen Schritte je Bein
    cad: a.average_cadence != null ? num(run ? a.average_cadence * 2 : a.average_cadence, 0) : null,
    pw: watts,
    pwMeasured: watts != null ? a.device_watts === true : null,
    np: num(a.weighted_average_watts, 0),
    kj: num(a.kilojoules, 0),
    kcal: num(a.calories, 0),
    elev: num(a.total_elevation_gain, 0),
    re: num(a.suffer_score, 0),
    rpe: num(a.perceived_exertion, 0),
    prs: a.pr_count ?? null,
    ach: a.achievement_count ?? null,
    kudos: a.kudos_count ?? null,
    comments: a.comment_count ?? null,
    photos: a.total_photo_count ?? a.photo_count ?? null,
    trainer: a.trainer === true,
    commute: a.commute === true,
    wt: a.workout_type ?? null,
    gear: a.gear_id || null,
    z: [0, 0, 0, 0, 0],
    te: null, teAn: null, load: null, label: null,
  };
}

const sportClass = (type: string) => (/run|walk|hik/.test(type) ? "foot" : /bik|cycl|ride/.test(type) ? "bike" : /swim/.test(type) ? "swim" : type);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Gleiche Einheit? Gleicher Tag, Start höchstens 3 Minuten auseinander, gleiche Sportart, Distanz ± 3 % (mind. 300 m) */
export function sameUnit(g: Obj, s: Obj): boolean {
  if (g.date !== s.date || !g.start || !s.start) return false;
  if (Math.abs(minutes(g.start) - minutes(s.start)) > 3) return false;
  if (sportClass(g.type || "") !== sportClass(s.type || "")) return false;
  const a = g.km || 0, b = s.km || 0;
  return Math.abs(a - b) <= Math.max(0.3, 0.03 * Math.max(a, b));
}

/** Was Strava zur Garmin-Einheit beiträgt (die Messwerte selbst kommen von Garmin) */
export const STRAVA_EXTRAS = ["sid", "re", "rpe", "prs", "ach", "kudos", "comments", "photos", "commute", "wt", "gear"] as const;

/**
 * Doppelte Einheiten zusammenführen: Lädt die Uhr zu Garmin und Strava hoch, gewinnt Garmin, und die
 * Strava-Extras hängen als `strava` an der Garmin-Einheit. Einheiten nur bei Strava bleiben eigenständig.
 */
export function mergeDuplicates(acts: Obj[]): Obj[] {
  const garmin = acts.filter((a) => a.src !== "strava");
  const byDay = new Map<string, Obj[]>();
  for (const g of garmin) (byDay.get(g.date) ?? byDay.set(g.date, []).get(g.date)!).push(g);
  const out = [...garmin];
  for (const s of acts.filter((a) => a.src === "strava")) {
    const g = (byDay.get(s.date) || []).find((x) => !x.strava && sameUnit(x, s));
    if (!g) { out.push(s); continue; }
    g.strava = Object.fromEntries(STRAVA_EXTRAS.map((k) => [k, s[k]]));
    if (s.name && !g.name) g.name = s.name;
  }
  return out;
}
