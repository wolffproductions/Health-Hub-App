// Erholungs-Ampel (#13): eine Regel für Oberfläche („Heute“) und Morgen-Push, damit beide immer dasselbe sagen.
// Eigene, offengelegte Regel (Garmins Training Readiness gibt es über die Personal API nicht):
//   HRV gegen Garmins Normalbereich · Ruhepuls gegen den eigenen 30-Tage-Median · Schlafscore ·
//   Trainingslast akut (7 Tage) zu chronisch (28 Tage)
// Bewusst ohne Importe, damit die Tests die Datei direkt laden können
const addDays = (date: string, n: number) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

type Day = Record<string, any> & { d: string };
export type Light = "g" | "y" | "r" | "";
export interface AmpelItem { key: string; st: Light; name: string; val: string; why: string }
export interface Ampel { day: string; light: Light; verdict: string; items: AmpelItem[] }

const DE = (x: number, d = 0) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const hm = (h: number) => { const m = Math.round(h * 60); return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); };
const finite = (a: Array<number | null | undefined>) => a.filter((x): x is number => x != null && isFinite(x));
export const mean = (a: Array<number | null | undefined>) => { const v = finite(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const median = (a: Array<number | null | undefined>) => {
  const v = finite(a).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Akut/chronisch am Tag `day`: Ø Trainingslast der letzten 7 bzw. 28 Tage (Tage ohne Training zählen als 0) */
export function loadRatio(loadByDay: Map<string, number>, day: string): number | null {
  const v: number[] = [];
  for (let i = 27; i >= 0; i--) v.push(loadByDay.get(addDays(day, -i)) || 0);
  const chronic = mean(v), acute = mean(v.slice(-7));
  return chronic ? acute! / chronic : null;
}

/** Ampel für die letzte Nacht mit HRV oder Schlafscore. `days` aufsteigend sortiert. */
export function assess(days: Day[], loadByDay: Map<string, number>): Ampel | null {
  const d = [...days].reverse().find((x) => x.hrv != null || x.score != null);
  if (!d) return null;
  const rhrBase = median(days.filter((x) => x.d < d.d && x.d >= addDays(d.d, -30)).map((x) => x.rhr));
  const ratio = loadRatio(loadByDay, d.d);
  const items: AmpelItem[] = [];
  if (d.hrv != null && d.hrvLo != null) {
    const third = d.hrvLo + (d.hrvHi - d.hrvLo) / 3;
    items.push({ key: "hrv", st: d.hrv < d.hrvLo ? "r" : d.hrv < third ? "y" : "g", name: "HRV letzte Nacht", val: d.hrv + " ms", why: `Normalbereich ${d.hrvLo}–${d.hrvHi} ms. Rot unter dem Bereich, gelb im unteren Drittel.` });
  } else items.push({ key: "hrv", st: "", name: "HRV letzte Nacht", val: "fehlt", why: "Für diese Nacht liegt kein HRV-Wert vor." });
  if (d.rhr != null && rhrBase != null) {
    const diff = d.rhr - rhrBase;
    items.push({ key: "rhr", st: diff >= 5 ? "r" : diff >= 2 ? "y" : "g", name: "Ruhepuls", val: d.rhr + " bpm", why: `Dein Median der letzten 30 Tage: ${DE(rhrBase)} bpm. Gelb ab +2, rot ab +5.` });
  } else items.push({ key: "rhr", st: "", name: "Ruhepuls", val: "fehlt", why: "Kein Ruhepuls für diesen Tag." });
  if (d.score != null) items.push({ key: "score", st: d.score < 60 ? "r" : d.score < 80 ? "y" : "g", name: "Schlafscore", val: String(d.score), why: `Schlafdauer ${d.slp != null ? hm(d.slp) : "–"} h. Gelb unter 80, rot unter 60.` });
  else items.push({ key: "score", st: "", name: "Schlafscore", val: "fehlt", why: "Kein Schlaf erfasst." });
  if (ratio != null) items.push({ key: "load", st: ratio > 1.5 ? "r" : ratio > 1.3 ? "y" : "g", name: "Last akut zu chronisch", val: DE(ratio, 2), why: "Letzte 7 Tage gegen letzte 28 Tage. Gelb über 1,3, rot über 1,5." });
  else items.push({ key: "load", st: "", name: "Last akut zu chronisch", val: "fehlt", why: "Noch zu wenig Trainingshistorie." });

  const reds = items.filter((i) => i.st === "r").length, yellows = items.filter((i) => i.st === "y").length;
  const known = items.filter((i) => i.st).length;
  let verdict: string, light: Light;
  if (known < 2) { verdict = "Zu wenig Daten für eine Einschätzung"; light = ""; }
  else if (reds) { verdict = "Erholung hat Vorrang"; light = "r"; }
  else if (yellows >= 2) { verdict = "Moderat trainieren"; light = "y"; }
  else if (yellows === 1) { verdict = "Training normal möglich"; light = "g"; }
  else { verdict = "Bereit für intensives Training"; light = "g"; }
  return { day: d.d, light, verdict, items };
}

/** Text der Morgen-Meldung, z. B. „🟢 Training normal möglich“ / „HRV 62 ms · Ruhepuls 47 · Schlaf 7:12 h (Score 81) · Last 1,1“ */
export function pushText(a: Ampel, day: Day | undefined): { title: string; body: string } {
  const dot = a.light === "r" ? "🔴" : a.light === "y" ? "🟡" : a.light === "g" ? "🟢" : "⚪️";
  const parts: string[] = [];
  if (day?.hrv != null) parts.push(`HRV ${day.hrv} ms`);
  if (day?.rhr != null) parts.push(`Ruhepuls ${day.rhr}`);
  if (day?.slp != null) parts.push(`Schlaf ${hm(day.slp)} h` + (day.score != null ? ` (Score ${day.score})` : ""));
  const load = a.items.find((i) => i.key === "load");
  if (load && load.st) parts.push(`Last ${load.val}`);
  return { title: `${dot} ${a.verdict}`, body: parts.join(" · ") || "Tippe für Details." };
}

// ---------- Zeitplan des Morgen-Pushs ----------
/** Wartezeit auf die Schlafdaten der letzten Nacht, bevor mit dem letzten Stand gesendet wird */
export const WAIT_MIN = 180;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Entscheidung ohne Seiteneffekte: senden, mit altem Stand senden, warten oder nichts tun */
export function decide(cfg: { on: boolean; time: string; lastSent?: string }, today: string, now: string, ampelDay: string | null): "send" | "send-stale" | "wait" | "skip" {
  if (!cfg.on || cfg.lastSent === today || toMin(now) < toMin(cfg.time)) return "skip";
  if (ampelDay === today) return "send";
  return toMin(now) - toMin(cfg.time) >= WAIT_MIN ? "send-stale" : "wait";
}
