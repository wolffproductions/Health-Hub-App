// Liest Tageswerte und Trainings aus D1 im Format, das die Oberfläche erwartet:
//   { daily: { "YYYY-MM-DD": { d, rhr, hrv, ... } }, acts: { id: {...} }, zones, profile, updated }
import type { Env } from "./env";
import { addDays, kvGetJson, kvPut, localDate } from "./util";
import type { Profile } from "./garmin/sync";
import { zoneTotals, type HrHist } from "./garmin/extract";
import { mergeDuplicates } from "./strava/extract";
import { prognose, type PredMode } from "./prognose";
import { assess } from "./ampel";
import { computeLevel } from "./level";
import { DEFAULT_SRC_CFG, pickDaily, type SrcCfg } from "./quellen";
import { mergeWhoop } from "./whoop/extract";
import { mergeGoogle } from "./google/extract";

/** Eigene Pulszonen (Grundlage, Tempo, Schwelle), Standard für /api/zones und die Auswertung */
export const DEFAULT_ZONES = [[129, 160], [161, 175], [176, 191]];

// Quellen-Priorität pro Metrik (#119): src/quellen.ts. Nachtwerte bei Garmin + WHOOP einstellbar (kv `srcCfg`).

/** Jetzt in Ortszeit als „JJJJ-MM-TTTHH:MM“ (für die Erholungszeit der Ampel) */
function nowLocal(tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export interface BuildOpts {
  /** Quellen, die nicht in die Antwort dürfen (Claude-Zugang ohne Freigabe: WHOOP, #119) */
  exclude?: string[];
}

export async function buildData(env: Env, days: number, opts: BuildOpts = {}) {
  const skip = new Set(opts.exclude || []);
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const from = addDays(today, -days + 1);

  const [metrics, acts, zones, upd, myZones, fitAge, srcCfg, whoopBody] = await Promise.all([
    env.DB.prepare("SELECT day, metric, source, value FROM daily_metrics WHERE day >= ?").bind(from)
      .all<{ day: string; metric: string; source: string; value: number }>(),
    // Die Route selbst bleibt draußen (lädt die Oberfläche einzeln über /api/route), nur ein Hinweis „rt“
    // Ebenso die Verläufe (#17, /api/streams), nur ein Hinweis „st“
    env.DB.prepare("SELECT source, data, laps, (route IS NOT NULL AND route <> '[]') AS has_route, (streams IS NOT NULL) AS has_streams, hr_hist, best, weather FROM activities WHERE day >= ? ORDER BY day").bind(from)
      .all<{ source: string; data: string; laps: string | null; has_route: number; has_streams: number; hr_hist: string | null; best: string | null; weather: string | null }>(),
    kvGetJson(env, "garminZones", []),
    env.DB.prepare("SELECT MAX(updated_at) AS t FROM daily_metrics").first<{ t: number | null }>(),
    kvGetJson<number[][]>(env, "zones", DEFAULT_ZONES),
    // Fitnessalter von Garmin (#78), neuester Stand mit Bausteinen
    kvGetJson<Record<string, unknown> | null>(env, "fitAge", null),
    kvGetJson<SrcCfg>(env, "srcCfg", DEFAULT_SRC_CFG),
    // Maximalpuls aus WHOOPs Körperdaten (#119), falls Garmin keine Zonen liefert
    kvGetJson<{ maxHr?: number | null } | null>(env, "whoopBody", null),
  ]);

  // Ein Wert pro Tag und Metrik nach Quellen-Priorität, HRV ohne Quellen-Mix (#119)
  const daily = pickDaily(metrics.results.filter((r) => !skip.has(r.source)), { ...DEFAULT_SRC_CFG, ...srcCfg });

  const list: Array<Record<string, any>> = [];
  for (const r of acts.results) {
    if (skip.has(r.source)) continue;
    const a = JSON.parse(r.data);
    if (a.hidden) continue; // bei Strava bzw. WHOOP gelöscht (#44, #119)
    a.src = r.source === "strava" || r.source === "whoop" || r.source === "google" ? r.source : a.src || "garmin";
    if (r.laps) { a.laps = JSON.parse(r.laps); a.lp = 1; }
    if (r.has_route) a.rt = 1;
    if (r.has_streams) a.st = 1;
    // Bestleistungen aus der .fit-Datei (d: Sekunden je Strecke, p: Watt je Zeitfenster), klein genug für /api/data
    if (r.best) { try { a.bst = JSON.parse(r.best); } catch { /* kaputter Eintrag */ } }
    // Wetter zur Mitte der Einheit (#54), nur wenn unter Konto eingeschaltet und schon geholt
    if (r.weather && r.weather !== "{}") { try { a.wx = JSON.parse(r.weather); } catch { /* kaputter Eintrag */ } }
    // Sekunden und Meter je eigener Zone (Z1–Z5); das Histogramm selbst bleibt auf dem Server
    if (r.hr_hist) {
      const hist = JSON.parse(r.hr_hist) as HrHist;
      if (hist.length) a.hz = zoneTotals(hist, myZones);
    }
    list.push(a);
  }
  // Gleiche Einheit von Garmin und Strava nur einmal, mit den Strava-Extras an der Garmin-Einheit (#44)
  const actsOut: Record<string, unknown> = {};
  // Ebenso Uhr + WHOOP-Band: die Einheit der Uhr bleibt, WHOOP-Strain hängt als `whoop` daran (#119)
  // Und Garmin-Uhr + Fitbit: die Garmin-Einheit bleibt, Google hängt als `google` daran
  for (const a of mergeGoogle(mergeWhoop(mergeDuplicates(list)))) actsOut[a.id] = a;

  // Erholungs-Ampel (#13): dieselbe Regel wie im Morgen-Push
  const loads = new Map<string, number>();
  for (const a of Object.values(actsOut) as Array<Record<string, any>>) loads.set(a.date, (loads.get(a.date) || 0) + (a.load || 0));
  const ampel = assess(Object.values(daily).sort((a, b) => (a.d < b.d ? -1 : 1)) as Array<Record<string, any> & { d: string }>, loads, Object.values(actsOut) as Array<Record<string, any> & { date: string }>, nowLocal(profile?.tz || env.TIMEZONE || "Europe/Berlin"));

  // Wettkampfprognose (#105): fertig gerechnet, Oberfläche und Claude-Zugang zeigen sie nur an
  const [vo2Rows, predCfg] = await Promise.all([
    env.DB.prepare("SELECT day, sport, value FROM vo2").all<{ day: string; sport: string; value: number }>(),
    kvGetJson<{ mode?: PredMode }>(env, "predCfg", {}),
  ]);
  const runZone = (zones as Array<{ sport?: string; max?: number }>).find((z) => z && /RUN/i.test(z.sport || "")) || (zones as Array<{ max?: number }>).find((z) => z && z.max);
  let pred = null;
  try {
    pred = prognose({
      today,
      // Wettkampf aus Strava (workout_type 1) zählt bei der Prognose als harte Zeit
      acts: (Object.values(actsOut) as Array<Record<string, any> & { date: string }>).map((a) => ({ ...a, race: (a.strava ? a.strava.wt : a.src === "strava" ? a.wt : null) === 1 })),
      days: Object.values(daily) as Array<{ d: string; rhr?: number }>,
      manualVo2: vo2Rows.results.map((r) => ({ d: r.day, sport: r.sport, v: r.value })),
      hrMax: runZone?.max ?? (skip.has("whoop") ? null : whoopBody?.maxHr) ?? null,
      mode: predCfg.mode || "auto",
    });
  } catch (e) { console.error("prognose", e); }

  // Level und Punkte (#192): zählen erst ab dem ersten Tag mit dieser Version (kv `levelStart`), alle beginnen bei Level 1
  let level = null;
  try {
    let lvStart = await kvGetJson<string | null>(env, "levelStart", null);
    if (!lvStart || !/^\d{4}-\d{2}-\d{2}$/.test(lvStart)) { lvStart = today; await kvPut(env, "levelStart", JSON.stringify(lvStart)); }
    const lvActs = (Object.values(actsOut) as Array<Record<string, any> & { id: string; date: string }>).map((a) => {
      const wt = a.strava ? a.strava.wt : a.src === "strava" ? a.wt : null;
      return { id: a.id, date: a.date, start: a.start, type: a.type, name: a.name, min: a.min, mov: a.mov, hr: a.hr, te: a.te, hidden: a.hidden, race: wt === 1 || wt === 11 };
    });
    level = computeLevel(lvActs, lvStart, today, runZone?.max ?? (skip.has("whoop") ? null : whoopBody?.maxHr) ?? null);
  } catch (e) { console.error("level", e); }

  // Body-Battery-Verlauf von heute und gestern (#79), nur wenn vorhanden
  const bb = await kvGetJson<{ at: string; curves: Array<{ day: string; pts: Array<[number, number]> }> } | null>(env, "bbCurves", null);

  return {
    v: 2,
    bb,
    ampel,
    prognose: pred,
    level,
    daily,
    acts: actsOut,
    zones,
    profile,
    fitAge,
    updated: upd?.t ? new Date(upd.t * 1000).toISOString() : null,
  };
}
