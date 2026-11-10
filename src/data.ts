// Liest Tageswerte und Trainings aus D1 im Format, das die Oberfläche erwartet:
//   { daily: { "YYYY-MM-DD": { d, rhr, hrv, ... } }, acts: { id: {...} }, zones, profile, updated }
import type { Env } from "./env";
import { addDays, kvGetJson, localDate } from "./util";
import type { Profile } from "./garmin/sync";
import { zoneTotals, type HrHist } from "./garmin/extract";
import { mergeDuplicates } from "./strava/extract";
import { assess } from "./ampel";

/** Eigene Pulszonen (Grundlage, Tempo, Schwelle), Standard für /api/zones und die Auswertung */
export const DEFAULT_ZONES = [[129, 160], [161, 175], [176, 191]];

// Liefern mehrere Quellen denselben Wert, gewinnt die erste in der Liste.
const SOURCE_PRIORITY: Record<string, string[]> = {
  kg: ["withings", "garmin", "manual"],
  fat: ["withings", "garmin", "manual"],
  default: ["garmin", "withings", "strava", "manual"],
};
const rank = (metric: string, source: string) => {
  const list = SOURCE_PRIORITY[metric] ?? SOURCE_PRIORITY.default;
  const i = list.indexOf(source);
  return i === -1 ? list.length : i;
};

export async function buildData(env: Env, days: number) {
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const from = addDays(today, -days + 1);

  const [metrics, acts, zones, upd, myZones, fitAge] = await Promise.all([
    env.DB.prepare("SELECT day, metric, source, value FROM daily_metrics WHERE day >= ?").bind(from)
      .all<{ day: string; metric: string; source: string; value: number }>(),
    // Die Route selbst bleibt draußen (lädt die Oberfläche einzeln über /api/route), nur ein Hinweis „rt“
    // Ebenso die Verläufe (#17, /api/streams), nur ein Hinweis „st“
    env.DB.prepare("SELECT source, data, laps, (route IS NOT NULL AND route <> '[]') AS has_route, (streams IS NOT NULL) AS has_streams, hr_hist FROM activities WHERE day >= ? ORDER BY day").bind(from)
      .all<{ source: string; data: string; laps: string | null; has_route: number; has_streams: number; hr_hist: string | null }>(),
    kvGetJson(env, "garminZones", []),
    env.DB.prepare("SELECT MAX(updated_at) AS t FROM daily_metrics").first<{ t: number | null }>(),
    kvGetJson<number[][]>(env, "zones", DEFAULT_ZONES),
    // Fitnessalter von Garmin (#78), neuester Stand mit Bausteinen
    kvGetJson<Record<string, unknown> | null>(env, "fitAge", null),
  ]);

  const daily: Record<string, Record<string, number | string>> = {};
  const chosen: Record<string, number> = {};
  for (const r of metrics.results) {
    const key = r.day + "|" + r.metric;
    const rk = rank(r.metric, r.source);
    if (chosen[key] !== undefined && chosen[key] <= rk) continue;
    chosen[key] = rk;
    (daily[r.day] ??= { d: r.day })[r.metric] = r.value;
  }

  const list: Array<Record<string, any>> = [];
  for (const r of acts.results) {
    const a = JSON.parse(r.data);
    if (a.hidden) continue; // bei Strava gelöscht (#44)
    a.src = r.source === "strava" ? "strava" : a.src || "garmin";
    if (r.laps) { a.laps = JSON.parse(r.laps); a.lp = 1; }
    if (r.has_route) a.rt = 1;
    if (r.has_streams) a.st = 1;
    // Sekunden und Meter je eigener Zone (Z1–Z5); das Histogramm selbst bleibt auf dem Server
    if (r.hr_hist) {
      const hist = JSON.parse(r.hr_hist) as HrHist;
      if (hist.length) a.hz = zoneTotals(hist, myZones);
    }
    list.push(a);
  }
  // Gleiche Einheit von Garmin und Strava nur einmal, mit den Strava-Extras an der Garmin-Einheit (#44)
  const actsOut: Record<string, unknown> = {};
  for (const a of mergeDuplicates(list)) actsOut[a.id] = a;

  // Erholungs-Ampel (#13): dieselbe Regel wie im Morgen-Push
  const loads = new Map<string, number>();
  for (const a of Object.values(actsOut) as Array<Record<string, any>>) loads.set(a.date, (loads.get(a.date) || 0) + (a.load || 0));
  const ampel = assess(Object.values(daily).sort((a, b) => (a.d < b.d ? -1 : 1)) as Array<Record<string, any> & { d: string }>, loads);

  // Body-Battery-Verlauf von heute und gestern (#79), nur wenn vorhanden
  const bb = await kvGetJson<{ at: string; curves: Array<{ day: string; pts: Array<[number, number]> }> } | null>(env, "bbCurves", null);

  return {
    v: 2,
    bb,
    ampel,
    daily,
    acts: actsOut,
    zones,
    profile,
    fitAge,
    updated: upd?.t ? new Date(upd.t * 1000).toISOString() : null,
  };
}
