// Level und Punkte (#192), reine Funktionen (getestet in test/level.test.ts), bewusst ohne Importe.
// Regeln (abgestimmt mit Eddie):
// - Es zählen nur Einheiten ab dem Starttag (alle beginnen bei Level 1, keine Punkte für die Vergangenheit).
// - 1 Punkt je Minute Bewegungszeit (wo die Quelle sie kennt, sonst Gesamtzeit), egal welche Sportart.
// - Hart = 1,5 Punkte je Minute: Wettkampf, Garmins Trainingseffekt ab 3,0 oder Schnittpuls ab 80 % HFmax.
// - Kraft, Yoga & Co. zählen höchstens 60 Minuten je Einheit (Pausen im Studio stecken in der Zeit).
// - Bis 15 Stunden je Woche volle Punkte, Minuten darüber zählen halb. Höchstens 200 Punkte am Tag.
// - +50 Punkte für jede Woche mit mindestens 3 Trainingstagen. Pausen kosten nie Punkte.
// - Level n → n + 1 kostet 100 + 20 · n Punkte (Level 2 also 120).
// Abzeichen (Schritt 2): Bronze/Silber/Gold, ebenfalls erst ab dem Starttag. Monats-Abzeichen jeden Monat neu.
// Jede erreichte Stufe bringt Punkte: Bronze +25, Silber +50, Gold +100.

export interface LvAct {
  id: string; date: string; start?: string; type?: string; name?: string;
  /** Gesamtzeit und Bewegungszeit in Minuten */
  min?: number | null; mov?: number | null;
  hr?: number | null; te?: number | null; race?: boolean; hidden?: boolean;
  km?: number | null; elev?: number | null;
}
/** Plan-Einheit für „Plan-Treue“: erledigt laut Abgleich (Lauf) bzw. selbst abgehakt */
export interface LvPlanSes { date: string; type: string; done: boolean }
export interface LvEntry { kind: "akt" | "woche" | "abzeichen"; date: string; pts: number; badge?: string; tier?: number; id?: string; type?: string; name?: string; min?: number; hard?: boolean; note?: string }
export interface Level { level: number; xp: number; into: number; need: number; start: string; today: number; recent: LvEntry[]; badges: BadgeState[] }

export interface BadgeDef { key: string; title: string; icon: string; unit: string; tiers: [number, number, number]; monthly?: boolean; desc: string }
/** Stand eines Abzeichens: beste Stufe (0 = noch keine), aktueller Wert (bei Monats-Abzeichen: dieser Monat) */
export interface BadgeState { key: string; title: string; icon: string; unit: string; tiers: [number, number, number]; monthly: boolean; desc: string;
  tier: number; value: number; nowTier: number; months?: Array<{ m: string; tier: number }>; text?: string }

export const BADGE_PTS = [25, 50, 100];
export const TIER_NAMES = ["Bronze", "Silber", "Gold"];
export const BADGES: BadgeDef[] = [
  { key: "lauf", title: "Laufen im Monat", icon: "laufen", unit: "km", tiers: [100, 200, 300], monthly: true, desc: "Kilometer gelaufen in einem Monat" },
  { key: "rad", title: "Rad im Monat", icon: "rad", unit: "km", tiers: [300, 600, 1000], monthly: true, desc: "Kilometer geradelt in einem Monat" },
  { key: "hm", title: "Höhenmeter im Monat", icon: "berg", unit: "m", tiers: [1000, 3000, 6000], monthly: true, desc: "Höhenmeter aller Einheiten in einem Monat" },
  { key: "serie", title: "Wochenserie", icon: "flamme", unit: "Wochen", tiers: [4, 10, 26], desc: "Wochen am Stück mit mindestens 3 Trainingstagen" },
  { key: "lang", title: "Lange Einheit", icon: "uhr", unit: "", tiers: [1, 2, 3], desc: "Lauf ab 1:30 / 2:00 / 3:00 h oder Rad ab 3 / 4 / 6 h am Stück" },
  { key: "frueh", title: "Frühaufsteher", icon: "sonnenaufgang", unit: "Einheiten", tiers: [5, 20, 50], desc: "Einheiten mit Start vor 7 Uhr" },
  { key: "wk", title: "Wettkampf", icon: "zielscheibe", unit: "Wettkämpfe", tiers: [1, 5, 10], desc: "Wettkämpfe (in Strava als Wettkampf markiert)" },
  { key: "plan", title: "Plan-Treue", icon: "kalender", unit: "Wochen", tiers: [1, 4, 12], desc: "Wochen, in denen du alle Einheiten aus dem Trainingsplan erledigt hast" },
];
const LONG_RUN = [90, 120, 180], LONG_RIDE = [180, 240, 360];
const isRun = (t?: string) => /running/.test(t || ""), isRide = (t?: string) => /cycl|biking|_ride|bike/.test(t || "");
const tierOf = (v: number, tiers: number[]) => tiers.filter((t) => v >= t).length;
const sundayOf = (d: string) => { const t = new Date(weekOf(d) + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 6); return t.toISOString().slice(0, 10); };
const nextWeek = (d: string) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 7); return t.toISOString().slice(0, 10); };

/** Abzeichen aus den Einheiten ab dem Starttag (sortiert) und dem Plan; Ereignisse = erreichte Stufen mit Datum */
export function computeBadges(list: LvAct[], start: string, today: string, plan: LvPlanSes[] = []): { badges: BadgeState[]; events: LvEntry[] } {
  const events: LvEntry[] = [];
  const ev = (key: string, tier: number, date: string, note?: string) => events.push({ kind: "abzeichen", badge: key, tier, date, pts: BADGE_PTS[tier - 1], note });
  const def = (k: string) => BADGES.find((b) => b.key === k)!;
  const state = (k: string, s: Partial<BadgeState>): BadgeState => { const d = def(k); return { ...d, monthly: !!d.monthly, tier: 0, value: 0, nowTier: 0, ...s }; };
  const out: BadgeState[] = [];
  const thisMonth = today.slice(0, 7);
  // Monats-Abzeichen: Summe je Monat, jede Stufe einmal je Monat
  const monthly = (k: string, val: (a: LvAct) => number) => {
    const d = def(k), sum = new Map<string, number>(), got = new Map<string, number>();
    for (const a of list) {
      const v = val(a); if (!(v > 0)) continue;
      const m = a.date.slice(0, 7), before = got.get(m) || 0, s = (sum.get(m) || 0) + v;
      sum.set(m, s);
      const t = tierOf(s, d.tiers);
      for (let i = before + 1; i <= t; i++) ev(k, i, a.date, m);
      got.set(m, Math.max(before, t));
    }
    const months = [...got.entries()].filter(([, t]) => t > 0).map(([m, tier]) => ({ m, tier })).sort((a, b) => (a.m < b.m ? 1 : -1));
    out.push(state(k, { tier: Math.max(0, ...months.map((x) => x.tier)), value: Math.round(sum.get(thisMonth) || 0), nowTier: got.get(thisMonth) || 0, months }));
  };
  monthly("lauf", (a) => (isRun(a.type) ? a.km || 0 : 0));
  monthly("rad", (a) => (isRide(a.type) ? a.km || 0 : 0));
  monthly("hm", (a) => a.elev || 0);

  // Wochenserie: Wochen am Stück mit mindestens 3 Trainingstagen; die laufende Woche bricht die Serie nicht
  {
    const d = def("serie"), days = new Map<string, Set<string>>(), third = new Map<string, string>();
    for (const a of list) {
      if (!(minutesOf(a) > 0)) continue;
      const w = weekOf(a.date), s = days.get(w) || new Set<string>(); s.add(a.date); days.set(w, s);
      if (s.size === WEEK_DAYS && !third.has(w)) third.set(w, a.date);
    }
    let run = 0, best = 0, cur = 0;
    const nowWk = weekOf(today);
    for (let w = weekOf(start); w <= nowWk; w = nextWeek(w)) {
      if (third.has(w)) {
        run++;
        if (run > best) { for (let i = tierOf(best, d.tiers) + 1; i <= tierOf(run, d.tiers); i++) ev("serie", i, third.get(w)!); best = run; }
      } else if (w !== nowWk) run = 0;
      cur = run;
    }
    out.push(state("serie", { tier: tierOf(best, d.tiers), value: cur, nowTier: tierOf(cur, d.tiers), text: best > cur ? "Beste Serie: " + best + " Wochen" : undefined }));
  }
  // Lange Einheit: längster Lauf bzw. längste Radfahrt (Bewegungszeit)
  {
    let best = 0, bestMin = 0, bestRun = false;
    for (const a of list) {
      const m = a.mov != null && a.mov > 0 ? a.mov : a.min || 0;
      const t = isRun(a.type) ? tierOf(m, LONG_RUN) : isRide(a.type) ? tierOf(m, LONG_RIDE) : 0;
      if (t > best) { for (let i = best + 1; i <= t; i++) ev("lang", i, a.date); best = t; }
      if ((isRun(a.type) || isRide(a.type)) && m > bestMin) { bestMin = m; bestRun = isRun(a.type); }
    }
    const h = Math.floor(bestMin / 60), mm = Math.round(bestMin % 60);
    out.push(state("lang", { tier: best, value: best, nowTier: best, text: bestMin ? "Längste " + (bestRun ? "Laufeinheit" : "Radfahrt") + ": " + h + ":" + String(mm).padStart(2, "0") + " h" : undefined }));
  }
  // Zähler: Frühaufsteher, Wettkampf
  const counter = (k: string, ok: (a: LvAct) => boolean) => {
    const d = def(k); let n = 0;
    for (const a of list) if (minutesOf(a) > 0 && ok(a)) { n++; const t = tierOf(n, d.tiers); if (t > tierOf(n - 1, d.tiers)) ev(k, t, a.date); }
    out.push(state(k, { tier: tierOf(n, d.tiers), value: n, nowTier: tierOf(n, d.tiers) }));
  };
  counter("frueh", (a) => !!a.start && a.start < "07:00");
  counter("wk", (a) => !!a.race);
  // Plan-Treue: abgeschlossene Wochen (ab dem Starttag), in denen jede Plan-Einheit erledigt ist
  {
    const d = def("plan"), weeks = new Map<string, LvPlanSes[]>();
    for (const s of plan) { const w = weekOf(s.date); weeks.set(w, [...(weeks.get(w) || []), s]); }
    let n = 0;
    for (const [w, ses] of [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const sun = sundayOf(w);
      if (w < start || sun >= today || !ses.length) continue;
      if (ses.every((s) => s.done)) { n++; const t = tierOf(n, d.tiers); if (t > tierOf(n - 1, d.tiers)) ev("plan", t, sun); }
    }
    out.push(state("plan", { tier: tierOf(n, d.tiers), value: n, nowTier: tierOf(n, d.tiers) }));
  }
  return { badges: BADGES.map((b) => out.find((x) => x.key === b.key)!), events };
}

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

export function computeLevel(acts: LvAct[], start: string, today: string, hrMax?: number | null, plan: LvPlanSes[] = []): Level {
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
  // Abzeichen-Stufen als Einträge dazu (nach Datum einsortiert, am selben Tag nach den Einheiten)
  const { badges, events } = computeBadges(list, start, today, plan);
  for (const e of events) {
    const b = BADGES.find((x) => x.key === e.badge)!;
    e.name = b.title + " · " + TIER_NAMES[(e.tier || 1) - 1];
    let i = entries.length; while (i > 0 && entries[i - 1].date > e.date) i--;
    entries.splice(i, 0, e);
  }
  const xp = entries.reduce((t, e) => t + e.pts, 0);
  const lv = levelFrom(xp);
  return {
    ...lv, xp, start, badges,
    today: entries.filter((e) => e.date === today).reduce((t, e) => t + e.pts, 0),
    recent: entries.slice(-20).reverse(),
  };
}
