// Trainingsplan von Claude (#20): Claude schreibt die Einheiten über den Claude-Zugang (#5), die App speichert sie
// (kv „trainingPlan“), zeigt sie auf „Heute“ und unter Einheiten, meldet sie im Morgen-Push und hakt sie ab.
// Reine Funktionen ohne Importe (getestet in test/training.test.ts).

export const TYPES = ["easy", "long", "strides", "tempo", "interval", "mp", "race", "recovery", "strength", "cross"] as const;
export type TType = (typeof TYPES)[number];
export interface TSession {
  date: string; type: TType; title: string; detail: string;
  km?: number | null; min?: number | null;
  /** Wiederholungen und Zielpace (s/km) harter Einheiten, fürs Abhaken in Prozent */
  reps?: number | null; pace?: number | null;
  /** so viele Wiederholungen reichen auch („nach 8 aufhören“): ab hier zählt die Anzahl voll */
  repsMin?: number | null;
  /** obere Pulsgrenze (bpm), z. B. für lockere Läufe */
  hrMax?: number | null;
  /** in der App verschoben (Tag geändert) */
  moved?: boolean;
}
export interface TPlan { goal: string | null; note: { date: string; text: string } | null; updated: string; sessions: TSession[] }
export const EMPTY_PLAN: TPlan = { goal: null, note: null, updated: "", sessions: [] };

const MAX_SESSIONS = 500;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const numIn = (x: unknown, lo: number, hi: number) => { const n = Number(x); return x != null && x !== "" && isFinite(n) && n >= lo && n <= hi ? n : null; };
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const mondayOf = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));

/** „4:50“ oder Sekunden → Sekunden pro km */
export function paceSec(x: unknown): number | null {
  if (typeof x === "number") return numIn(x, 120, 900);
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(x ?? "").trim());
  return m ? numIn(Number(m[1]) * 60 + Number(m[2]), 120, 900) : null;
}

/** Eine Einheit von Claude prüfen; liefert die Einheit oder einen Fehlertext */
export function cleanSession(x: any): TSession | string {
  if (!x || typeof x !== "object") return "Einheit fehlt.";
  if (!isDay(x.date)) return "date bitte als JJJJ-MM-TT.";
  const type = TYPES.includes(x.type) ? (x.type as TType) : null;
  if (!type) return `type muss eines von ${TYPES.join(", ")} sein (${x.date}).`;
  const title = text(x.title, 80);
  if (!title) return `title fehlt (${x.date}).`;
  const s: TSession = { date: x.date, type, title, detail: text(x.detail, 600) };
  const km = numIn(x.km, 0.1, 300), min = numIn(x.min, 1, 1440), reps = numIn(x.reps, 1, 60), hr = numIn(x.hr_max ?? x.hrMax, 80, 230);
  const pace = paceSec(x.pace_per_km ?? x.pace);
  if (km != null) s.km = Math.round(km * 10) / 10;
  if (min != null) s.min = Math.round(min);
  if (reps != null) s.reps = Math.round(reps);
  const rmin = numIn(x.reps_min ?? x.repsMin, 1, 60);
  if (s.reps != null && rmin != null && Math.round(rmin) < s.reps) s.repsMin = Math.round(rmin);
  if (pace != null) s.pace = Math.round(pace);
  if (hr != null) s.hrMax = Math.round(hr);
  return s;
}

/**
 * Neue Einheiten eintragen. Ersetzt wird alles ab `replaceFrom` (Standard: frühester Tag der neuen Einheiten)
 * bis `replaceTo` (Standard: offen = ganzer Rest des Plans). Ältere Einheiten bleiben als Verlauf.
 */
export function mergeSessions(plan: TPlan, add: TSession[], replaceFrom?: string | null, replaceTo?: string | null): TPlan {
  const from = replaceFrom || add.reduce((m, s) => (s.date < m ? s.date : m), "9999-12-31");
  const to = replaceTo || "9999-12-31";
  const keep = plan.sessions.filter((s) => s.date < from || s.date > to);
  const sessions = [...keep, ...add].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-MAX_SESSIONS);
  return { ...plan, sessions };
}

/** Einheit auf einen anderen Tag derselben Woche legen; liegt dort schon etwas, wird getauscht (Wettkampf bleibt fest) */
export function moveSession(plan: TPlan, from: string, index: number, to: string): TPlan | string {
  if (!isDay(from) || !isDay(to) || mondayOf(from) !== mondayOf(to)) return "Nur innerhalb derselben Woche.";
  const onDay = plan.sessions.filter((s) => s.date === from);
  const a = onDay[index] || onDay[0];
  if (!a) return "Keine Einheit an diesem Tag.";
  if (a.type === "race") return "Der Wettkampf bleibt an seinem Tag.";
  const there = plan.sessions.filter((s) => s.date === to);
  if (there.some((s) => s.type === "race")) return "An dem Tag ist der Wettkampf.";
  const sessions = plan.sessions.map((s) => (s === a ? { ...s, date: to, moved: true } : there.includes(s) ? { ...s, date: from, moved: true } : s));
  sessions.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return { ...plan, sessions };
}

/** Kurzer Text für Push und „Heute“: „Locker · 10 km · 4:50 /km · unter 150 bpm“ */
export function sessionLine(s: TSession): string {
  const p: string[] = [s.title];
  if (s.km) p.push(String(s.km).replace(".", ",") + " km");
  else if (s.min) p.push(s.min + " min");
  if (s.pace) p.push(Math.floor(s.pace / 60) + ":" + String(s.pace % 60).padStart(2, "0") + " /km");
  if (s.hrMax) p.push("unter " + s.hrMax + " bpm");
  return p.join(" · ");
}
