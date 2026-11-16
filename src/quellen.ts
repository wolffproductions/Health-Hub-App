// Welche Quelle liefert welchen Tageswert? Reine Funktionen, getestet in test/quellen.test.ts.
// Bewusst ohne Importe, damit die Tests die Datei direkt laden können.
//
// Regeln (#119):
//   - Liefern mehrere Quellen denselben Wert, gewinnt die erste in der Prioritätsliste der Metrik.
//   - Nachtwerte (Schlaf, HRV, Ruhepuls, SpO2): wer Garmin-Uhr und WHOOP-Band trägt, wählt unter Konto → WHOOP,
//     welche Quelle zählt. Standard WHOOP (misst nachts genau dafür). Trainings bleiben bei Garmin (GPS, Runden).
//   - HRV nicht mischen: Beide messen RMSSD, aber zu anderen Zeiten der Nacht. Ab dem ersten Tag der bevorzugten
//     Quelle zählt nur noch sie (fehlende Nächte bleiben leer statt mit der anderen Quelle aufgefüllt). Wochenschnitt
//     und Normalbereich (hrvWk/hrvLo/hrvHi) kommen immer aus derselben Quelle wie der HRV-Wert. `hrvSrc` sagt, welche.

export type NightPref = "whoop" | "garmin";
export interface SrcCfg { night: NightPref }
export const DEFAULT_SRC_CFG: SrcCfg = { night: "whoop" };

/** Nachtwerte, bei denen Garmin und WHOOP konkurrieren */
export const NIGHT_METRICS = ["hrv", "rhr", "slp", "deep", "rem", "awake", "score", "resp", "bed", "wake", "spo2"];
const HRV_FAMILY = ["hrvWk", "hrvLo", "hrvHi"];

export function priority(metric: string, cfg: SrcCfg = DEFAULT_SRC_CFG): string[] {
  if (metric === "kg" || metric === "fat") return ["withings", "garmin", "whoop", "manual"];
  if (NIGHT_METRICS.includes(metric) || HRV_FAMILY.includes(metric)) {
    return cfg.night === "garmin" ? ["garmin", "whoop", "withings", "strava", "manual"] : ["whoop", "garmin", "withings", "strava", "manual"];
  }
  return ["garmin", "withings", "strava", "whoop", "manual"];
}
const rank = (metric: string, source: string, cfg: SrcCfg) => {
  const list = priority(metric, cfg);
  const i = list.indexOf(source);
  return i === -1 ? list.length : i;
};

export interface Row { day: string; metric: string; source: string; value: number }
export type Daily = Record<string, Record<string, number | string>>;

export function pickDaily(rows: Row[], cfg: SrcCfg = DEFAULT_SRC_CFG): Daily {
  const daily: Daily = {};
  const chosen: Record<string, number> = {};
  // HRV-Werte je Tag und Quelle getrennt sammeln, die Auswahl kommt danach
  const hrv = new Map<string, Map<string, Record<string, number>>>();
  for (const r of rows) {
    if (r.metric === "hrv" || HRV_FAMILY.includes(r.metric)) {
      const bySrc = hrv.get(r.day) ?? hrv.set(r.day, new Map()).get(r.day)!;
      (bySrc.get(r.source) ?? bySrc.set(r.source, {}).get(r.source)!)[r.metric] = r.value;
      daily[r.day] ??= { d: r.day };
      continue;
    }
    const key = r.day + "|" + r.metric;
    const rk = rank(r.metric, r.source, cfg);
    if (chosen[key] !== undefined && chosen[key] <= rk) continue;
    chosen[key] = rk;
    (daily[r.day] ??= { d: r.day })[r.metric] = r.value;
  }
  // Bevorzugte HRV-Quelle: die erste in der Liste, die überhaupt HRV liefert; ab ihrem ersten Tag nur noch sie
  const order = priority("hrv", cfg);
  const firstDay = new Map<string, string>();
  for (const [day, bySrc] of hrv) for (const [src, v] of bySrc) if (v.hrv != null && (!firstDay.has(src) || day < firstDay.get(src)!)) firstDay.set(src, day);
  const main = order.find((s) => firstDay.has(s)) ?? [...firstDay.keys()][0];
  for (const [day, bySrc] of hrv) {
    let src: string | undefined;
    if (main && day >= firstDay.get(main)!) src = bySrc.get(main)?.hrv != null ? main : undefined;
    else src = order.find((s) => bySrc.get(s)?.hrv != null) ?? [...bySrc.keys()].find((s) => bySrc.get(s)!.hrv != null);
    if (!src) continue;
    const v = bySrc.get(src)!;
    for (const k of ["hrv", ...HRV_FAMILY]) if (v[k] != null) daily[day][k] = v[k];
    daily[day].hrvSrc = src;
  }
  // Tage ohne jeden Wert (nur HRV-Familie einer nicht gewählten Quelle) wieder entfernen
  for (const day of Object.keys(daily)) if (Object.keys(daily[day]).length === 1) delete daily[day];
  return daily;
}
