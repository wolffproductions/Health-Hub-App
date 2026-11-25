// Level und Punkte (#192), reine Funktionen (getestet in test/level.test.ts), bewusst ohne Importe.
// Regeln (abgestimmt mit Eddie):
// - Es zählen nur Einheiten ab dem Starttag (alle beginnen bei Level 1, keine Punkte für die Vergangenheit).
// - 1 Punkt je Minute Bewegungszeit (wo die Quelle sie kennt, sonst Gesamtzeit), egal welche Sportart.
// - Hart = 1,5 Punkte je Minute: Wettkampf, Garmins Trainingseffekt ab 3,0 oder Schnittpuls ab 80 % HFmax.
// - Kraft, Yoga & Co. zählen höchstens 60 Minuten je Einheit (Pausen im Studio stecken in der Zeit).
// - Bis 15 Stunden je Woche volle Punkte, Minuten darüber zählen halb. Höchstens 200 Punkte am Tag.
// - +50 Punkte für jede Woche mit mindestens 3 Trainingstagen. Pausen kosten nie Punkte.
// - Level n → n + 1 kostet 100 + 20 · n Punkte (Level 2 also 120).

export interface LvAct {
  id: string; date: string; start?: string; type?: string; name?: string;
  /** Gesamtzeit und Bewegungszeit in Minuten */
  min?: number | null; mov?: number | null;
  hr?: number | null; te?: number | null; race?: boolean; hidden?: boolean;
}
export interface LvEntry { kind: "akt" | "woche"; date: string; pts: number; id?: string; type?: string; name?: string; min?: number; hard?: boolean; note?: string }
export interface Level { level: number; xp: number; into: number; need: number; start: string; today: number; recent: LvEntry[] }

export const DAY_CAP = 200, WEEK_FULL_MIN = 15 * 60, WEEK_BONUS = 50, WEEK_DAYS = 3, CALM_CAP_MIN = 60, HARD_F = 1.5;
/** Sportarten mit viel Stehzeit (Garmin-Namen, andere Quellen werden darauf abgebildet) */
const CALM = /strength|yoga|pilates|fitness_equipment|hiit|stretch|breath|indoor_cardio|mobility|meditation|barre/;

export const levelCost = (n: number) => 100 + 20 * n;

/** Zählende Minuten einer Einheit: Bewegungszeit vor Gesamtzeit, Kraft & Co. gedeckelt */
export function minutesOf(a: LvAct): number {
  const m = a.mov != null && a.mov > 0 ? a.mov : a.min || 0;
  if (!(m > 0)) return 0;
  return CALM.test(a.type || "") ? Math.min(m, CALM_CAP_MIN) : m;
}

export function isHard(a: LvAct, hrMax: number | null | undefined): boolean {
  if (a.race) return true;
  if (a.te != null && a.te >= 3) return true;
  return !!(a.hr && hrMax && a.hr >= 0.8 * hrMax);
}

/** Montag der Woche (JJJJ-MM-TT) */
export function weekOf(d: string): string {
  const t = new Date(d + "T12:00:00Z"), wd = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - wd);
  return t.toISOString().slice(0, 10);
}

/** Level aus Gesamtpunkten: aktuelles Level, Punkte darin, Punkte bis zum nächsten */
export function levelFrom(xp: number): { level: number; into: number; need: number } {
  let level = 1, rem = Math.max(0, Math.floor(xp));
  while (rem >= levelCost(level)) { rem -= levelCost(level); level++; }
  return { level, into: rem, need: levelCost(level) };
}

export function computeLevel(acts: LvAct[], start: string, today: string, hrMax?: number | null): Level {
  const list = acts.filter((a) => a && !a.hidden && typeof a.date === "string" && a.date >= start && a.date <= today)
    .sort((a, b) => (a.date + (a.start || "") < b.date + (b.start || "") ? -1 : 1));
  const entries: LvEntry[] = [];
  const weekMin = new Map<string, number>(), dayPts = new Map<string, number>(), weekDays = new Map<string, Set<string>>(), bonusDone = new Set<string>();
  for (const a of list) {
    const m = minutesOf(a);
    if (!(m > 0)) continue;
    const wk = weekOf(a.date), used = weekMin.get(wk) || 0;
    const full = Math.max(0, Math.min(m, WEEK_FULL_MIN - used)), half = m - full;
    weekMin.set(wk, used + m);
    const hard = isHard(a, hrMax), f = hard ? HARD_F : 1;
    let pts = Math.round((full + half / 2) * f);
    const dayUsed = dayPts.get(a.date) || 0;
    const capped = dayUsed + pts > DAY_CAP;
    pts = Math.max(0, Math.min(pts, DAY_CAP - dayUsed));
    dayPts.set(a.date, dayUsed + pts);
    const notes = [];
    if (minutesOf(a) < (a.mov != null && a.mov > 0 ? a.mov : a.min || 0)) notes.push("höchstens " + CALM_CAP_MIN + " Min. gezählt");
    if (half > 0) notes.push("über " + WEEK_FULL_MIN / 60 + " h in der Woche halb");
    if (capped) notes.push("Tagesgrenze " + DAY_CAP);
    entries.push({ kind: "akt", date: a.date, pts, id: a.id, type: a.type, name: a.name, min: Math.round(m), hard, note: notes.join(", ") || undefined });
    // Wochenbonus, sobald der dritte Trainingstag erreicht ist
    const days = weekDays.get(wk) || new Set<string>(); days.add(a.date); weekDays.set(wk, days);
    if (days.size >= WEEK_DAYS && !bonusDone.has(wk)) {
      bonusDone.add(wk);
      entries.push({ kind: "woche", date: a.date, pts: WEEK_BONUS, note: WEEK_DAYS + " Trainingstage in der Woche" });
    }
  }
  const xp = entries.reduce((t, e) => t + e.pts, 0);
  const lv = levelFrom(xp);
  return {
    ...lv, xp, start,
    today: entries.filter((e) => e.date === today).reduce((t, e) => t + e.pts, 0),
    recent: entries.slice(-20).reverse(),
  };
}
