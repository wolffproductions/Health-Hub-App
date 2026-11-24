// Trainingsplan (#20): Ziel → Plan bis zum Wettkampf, reine Funktionen (getestet in test/plan.test.ts), bewusst ohne Importe.
// Grundlage: Jack Daniels' VDOT (Tempobereiche aus der Form), Phasen Grundlage → Aufbau → Spitze → Taper, Regeln gegen
// Überlastung: Umfang höchstens ~8 % mehr pro Woche, jede 4. Woche leichter, langer Lauf höchstens ~30 % der Woche,
// höchstens 2 harte Einheiten. Die aktuelle Form kommt aus der Prognose (#105, harte Zeiten zählen dort am stärksten).

export type GoalDist = 5000 | 10000 | 21097 | 42195;
export interface Goal {
  kind: "race" | "fit";
  dist?: GoalDist;
  /** Wettkampftag YYYY-MM-DD */
  date?: string;
  /** Wunschzeit in Sekunden (optional) */
  target?: number | null;
  /** Lauftage pro Woche (3–6) */
  days: number;
  /** Tag des langen Laufs, 0 = Montag … 6 = Sonntag */
  longDay: number;
  /** Höchster Wochenumfang in km (optional, sonst aus Strecke, Lauftagen und Form) */
  peak?: number | null;
  /** Tag, an dem der Plan angelegt wurde (YYYY-MM-DD); der Plan beginnt am Montag dieser Woche */
  created: string;
  /** Start-Umfang in km (optional, sonst Schnitt der letzten 3 Wochen) */
  startKm?: number | null;
  /** Fester Tag für Intervalle (z. B. Vereinstraining), 0 = Montag … 6 = Sonntag */
  hardDay?: number | null;
  /** Verschobene Einheiten: ursprünglicher Tag → neuer Tag (gleiche Woche, belegter Tag wird getauscht) */
  moves?: Record<string, string>;
  /** Pausen: Plan ruht, danach langsamer Wiedereinstieg (krank stärker als Urlaub) */
  pauses?: Pause[];
  /** Selbst abgehakte Einheiten (Tag der Einheit), z. B. ohne Uhr gelaufen */
  manual?: string[];
}
export interface Pause { from: string; to: string; kind: "krank" | "urlaub" }
/** Aktuelle Form: VDOT (Daniels), Wochenumfang und längster Lauf der letzten Wochen (km) */
/** pen = Ausdauer-Aufschlag der Prognose für die Zielstrecke (Anteil, z. B. 0,03 = 3 % langsamer) */
export interface Current { vdot: number | null; weekKm: number; longKm: number; pen?: number; hr?: HrInfo | null }
/** Pulszonen (bpm) und lockere Pace aus den eigenen Läufen */
export interface HrInfo { zones: { z2: [number, number]; z3: [number, number]; z4: [number, number]; z5: [number, number] } | null; e: [number, number] | null; n: number }
export interface HrSample { date: string; hr: number; pace: number; sec: number }

export type SessionType = "easy" | "long" | "strides" | "tempo" | "interval" | "race" | "mp";
export interface Session {
  date: string; type: SessionType; title: string; km: number; detail: string; zone: string; moved?: boolean;
  /** geplante Wiederholungen und Zielpace (s/km) harter Einheiten, für das Abhaken */
  reps?: number; pace?: number;
  /** erledigt: gelaufene Einheit (id), Erfüllung in % (null beim Wettkampf), Begründung; manual = selbst abgehakt */
  done?: { id: string | null; pct: number | null; why: string; km: number | null; sec: number | null; manual?: boolean };
  /** vergangen und nicht gelaufen */
  missed?: boolean;
}
/** Gelaufene Einheit für den Abgleich */
export interface DoneRun { id: string; date: string; km: number; min: number; hr?: number | null; laps?: Array<{ hr?: number | null; v?: number | null; s?: number | null; m?: number | null }> | null }
export type Phase = "Grundlage" | "Aufbau" | "Spitze" | "Taper" | "Erhalt";
export interface Week { start: string; phase: Phase; km: number; easy: boolean; sessions: Session[]; pause?: Pause["kind"]; comeback?: boolean }
/** src: „puls“ = lockere Pace aus den eigenen Läufen und Pulszonen, „form“ = nur aus der Form gerechnet */
export interface Paces { e: [number, number]; m: number; t: number; i: number; r: number; src: "puls" | "form"; hr: HrInfo["zones"] }
export interface Feasibility { now: number | null; lo: number | null; hi: number | null; rating: "realistisch" | "ambitioniert" | "sehr ambitioniert" | null; suggest: number | null }
export interface Plan { weeks: Week[]; paces: Paces | null; feas: Feasibility; vdot: number | null; targetVdot: number | null }

// ---------- Daniels ----------
const vo2Need = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v; // v in m/min
const vo2Share = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); // t in min
export const vdotFromRace = (d: number, sec: number) => vo2Need(d / (sec / 60)) / vo2Share(sec / 60);
export function raceFromVdot(vdot: number, d: number): number {
  let lo = 60, hi = 6 * 3600;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotFromRace(d, mid) > vdot) lo = mid; else hi = mid; }
  return Math.round((lo + hi) / 2);
}
/** Pace (s/km) beim Anteil f der VO2max */
const paceAt = (vdot: number, f: number) => {
  const c = -4.6 - f * vdot, v = (-0.182258 + Math.sqrt(0.182258 ** 2 - 4 * 0.000104 * c)) / (2 * 0.000104);
  return 60000 / v;
};
/**
 * Tempobereiche: M Marathon, T Schwelle (88 %), I Intervalle (98 %), R Wiederholungen (~105 %) aus der Form (Daniels).
 * Locker NICHT aus der Form: Wer schnell ist, aber wenig Umfang hat, kann locker nicht 4:00 laufen. Deshalb aus den
 * eigenen Läufen (Pace bei lockerem Puls, 70–79 % vom Maximalpuls), sonst vorsichtig Marathontempo + 45 bis 90 s.
 */
export function paces(vdot: number, hr?: HrInfo | null): Paces {
  const m = Math.round(raceFromVdot(vdot, 42195) / 42.195);
  const own = hr?.e && hr.e[0] >= m + 15 ? hr.e : null;
  return { e: own ? [own[0], own[1]] : [m + 45, m + 90], m, t: Math.round(paceAt(vdot, 0.88)), i: Math.round(paceAt(vdot, 0.98)), r: Math.round(paceAt(vdot, 1.05)), src: own ? "puls" : "form", hr: hr?.zones || null };
}

/**
 * Pulsbereiche fürs Training aus dem Maximalpuls (Daniels): z2 locker 70–79 %, z3 Marathon 80–85 %, z4 Schwelle 88–92 %,
 * z5 Intervalle 97–100 %. Nicht Garmins Zone 2: die liegt meist bei 60–70 % und ist eher Erholung.
 */
export function zonesFrom(z: { max?: number | null } | null | undefined): HrInfo["zones"] {
  const m = z?.max;
  if (!m || m < 140 || m > 230) return null;
  const b = (lo: number, hi: number): [number, number] => [Math.round(m * lo), Math.round(m * hi)];
  return { z2: b(0.7, 0.79), z3: b(0.8, 0.85), z4: b(0.88, 0.92), z5: b(0.97, 1) };
}

/**
 * Lockere Pace aus den eigenen Läufen: Pace gegen Puls (gewichtete Gerade aus Runden bzw. ganzen Läufen der letzten
 * 8 Wochen, die letzten 4 Wochen doppelt), dann die Pace an den Grenzen des lockeren Pulsbereichs. Rechnet sich bei jedem Abruf neu:
 * Wird man fitter, wird die Pace bei gleichem Puls schneller.
 */
export function hrPace(samples: HrSample[], today: string, zones: HrInfo["zones"]): HrInfo {
  const t0 = Date.parse(today + "T12:00:00Z");
  const xs: Array<[number, number, number]> = [];
  for (const x of samples) {
    const age = (t0 - Date.parse(x.date + "T12:00:00Z")) / 864e5;
    if (age < 0 || age > 56 || !(x.hr >= 90 && x.hr <= 210) || !(x.pace >= 150 && x.pace <= 600) || !(x.sec >= 180)) continue;
    xs.push([x.hr, x.pace, Math.min(3, x.sec / 600) * (age <= 28 ? 2 : 1)]);
  }
  const out: HrInfo = { zones, e: null, n: xs.length };
  if (!zones || xs.length < 5) return out;
  const W = xs.reduce((a, x) => a + x[2], 0);
  const mx = xs.reduce((a, x) => a + x[0] * x[2], 0) / W, my = xs.reduce((a, x) => a + x[1] * x[2], 0) / W;
  const sxx = xs.reduce((a, x) => a + x[2] * (x[0] - mx) ** 2, 0), sxy = xs.reduce((a, x) => a + x[2] * (x[0] - mx) * (x[1] - my), 0);
  if (Math.sqrt(sxx / W) < 4) return out; // zu wenig Spanne im Puls
  const b = sxy / sxx;
  if (!(b < -0.5)) return out; // höherer Puls muss schneller sein
  const at = (h: number) => Math.round(my + b * (h - mx));
  const fast = at(zones.z2[1]), slow = Math.min(at(zones.z2[0]), fast + 45);
  if (fast >= 150 && slow <= 600) out.e = [fast, slow];
  return out;
}
export const pace = (s: number) => { const r = Math.round(s); return Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0"); };
/** Zeit als 18:30 bzw. 1:24:05 */
export const clock = (s: number) => { const r = Math.round(s), h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), x = String(r % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : m + ":" + x; };

// ---------- Einschätzung ----------
/** Realistischer Zuwachs an VDOT in w Wochen: weniger, je besser man schon ist (Erfahrungswerte, eher vorsichtig) */
export const vdotGain = (vdot: number, weeks: number) => Math.min(6, (weeks / 4) * (vdot < 40 ? 1.2 : vdot < 50 ? 0.9 : vdot < 58 ? 0.6 : 0.4));
/**
 * Heute möglich und mit dem Plan realistisch. pen = fehlende Ausdauer heute (aus der Prognose): Der Plan baut
 * Umfang und lange Läufe auf und schließt diese Lücke in etwa 12 Wochen – das zählt zusätzlich als Fortschritt.
 */
/** Gleiche Strecke? Die Prognose führt den Halbmarathon als 21097,5 m, der Plan als 21097 m */
export const sameDist = (a: number, b: number) => Math.abs(a - b) < 1;

export function feasibility(cur: number | null, d: number, weeks: number, target: number | null | undefined, pen = 0): Feasibility {
  if (cur == null) return { now: null, lo: null, hi: null, rating: null, suggest: null };
  const g = vdotGain(cur, weeks), close = Math.min(1, weeks / 12);
  const t = (v: number, rest: number) => raceFromVdot(v, d) * (1 + pen * rest);
  const now = t(cur, 1), lo = t(cur + g * 1.2, 1 - close), hi = t(cur + g * 0.5, 1 - close * 0.6);
  const suggest = Math.round(t(cur + g * 0.8, 1 - close * 0.8) / 10) * 10;
  let rating: Feasibility["rating"] = null;
  if (target) rating = target >= hi ? "realistisch" : target >= lo ? "ambitioniert" : "sehr ambitioniert";
  return { now, lo, hi, rating, suggest };
}

// ---------- Plan ----------
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monday = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
const r1 = (x: number) => Math.round(x * 2) / 2; // auf halbe Kilometer
// Höchster Wochenumfang je Ziel bei 5 Lauftagen (km), längster langer Lauf (km)
const PEAK: Record<number, number> = { 5000: 42, 10000: 50, 21097: 58, 42195: 72 };
const LONG_MAX: Record<number, number> = { 5000: 16, 10000: 18, 21097: 22, 42195: 32 };
// Anteil des langen Laufs an der Woche ab der Aufbauphase (Marathon braucht längere lange Läufe)
const LONG_SHARE: Record<number, number> = { 5000: 0.3, 10000: 0.3, 21097: 0.32, 42195: 0.42 };

/** Wochentage für die Läufe: langer Lauf fest, harte Einheiten nicht direkt davor/danach, Rest locker */
export function dayLayout(days: number, longDay: number, hardDay?: number | null): { long: number; hard: number[]; easy: number[] } {
  const n = Math.max(3, Math.min(6, days)), free = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== longDay);
  const dist = (a: number, b: number) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
  // Fester Intervall-Tag: steht immer zuerst, zweiter harter Tag mit Abstand zu ihm und zum langen Lauf
  if (hardDay != null && hardDay >= 0 && hardDay <= 6 && hardDay !== longDay) {
    const fx = hardDay, gap = (d: number) => Math.min(dist(d, longDay), dist(d, fx));
    const second = free.filter((d) => d !== fx).sort((a, b) => gap(b) - gap(a) || a - b)[0];
    const hardUse = n >= 4 && second != null && gap(second) >= 2 ? [fx, second] : [fx];
    const easy = free.filter((d) => !hardUse.includes(d)).sort((a, b) => gap(b) - gap(a) || a - b).slice(0, n - 1 - hardUse.length).sort((a, b) => a - b);
    return { long: longDay, hard: hardUse, easy };
  }
  // harte Tage: möglichst weit vom langen Lauf und voneinander
  const hard: number[] = [];
  const cand = [...free].sort((a, b) => dist(b, longDay) - dist(a, longDay) || a - b);
  for (const d of cand) { if (hard.length >= 2) break; if (dist(d, longDay) >= 2 && hard.every((h) => dist(h, d) >= 2)) hard.push(d); }
  const restCount = n - 1 - Math.min(hard.length, n >= 4 ? 2 : 1);
  const hardUse = hard.slice(0, n >= 4 ? 2 : 1).sort((a, b) => a - b);
  // lockere Tage: nicht direkt vor dem langen Lauf, wenn es sich vermeiden lässt
  const easy = free.filter((d) => !hardUse.includes(d)).sort((a, b) => (dist(b, longDay) === 1 && b === (longDay + 6) % 7 ? -1 : 0) || dist(b, longDay) - dist(a, longDay)).slice(0, restCount).sort((a, b) => a - b);
  return { long: longDay, hard: hardUse, easy };
}

const ZONE_OF = { e: "z2", m: "z3", t: "z4", i: "z5", r: "z5" } as const;
const range = (p: Paces, kind: "e" | "m" | "t" | "i" | "r") => {
  const z = p.hr && kind !== "r" ? p.hr[ZONE_OF[kind]] : null;
  return (kind === "e" ? pace(p.e[0]) + "–" + pace(p.e[1]) : pace(p[kind] - 3) + "–" + pace(p[kind] + 3)) + " /km" + (z ? " (" + z[0] + "–" + z[1] + " bpm)" : "");
};

/** Harte Einheit je Phase und Ziel (erste bzw. zweite der Woche); km = Gesamtstrecke inkl. Ein- und Auslaufen */
function quality(phase: Phase, d: number, slot: number, p: Paces | null, scale: number): Omit<Session, "date"> {
  const P = (k: "e" | "m" | "t" | "i" | "r") => (p ? range(p, k) : k === "e" ? "locker, Zone 2" : k === "t" ? "„angenehm schwer“, Zone 4" : "zügig, Zone 4–5");
  const short = d <= 10000;
  if (phase === "Grundlage" || phase === "Erhalt") {
    if (slot === 0) return { type: "strides", title: "Locker mit Steigerungen", km: r1(8 * scale), zone: "Z2", detail: `Locker ${P("e")}, am Ende 6 × 20 s Steigerung bis ${P("r")}, dazwischen ganz locker` };
    return { type: "tempo", title: "Schwellenlauf", km: r1(9 * scale), zone: "Z4", detail: `2 km einlaufen, 3 × 8 min in ${P("t")}, 2 min Trabpause, auslaufen` };
  }
  if (phase === "Taper") {
    return slot === 0
      ? { type: "interval", title: "Kurz und knackig", km: r1(7 * scale), zone: "Z4–5", detail: `2 km einlaufen, 4 × 400 m in ${P("i")}, 200 m Trab, auslaufen` }
      : { type: "easy", title: "Locker", km: r1(6 * scale), zone: "Z2", detail: `Locker ${P("e")}` };
  }
  if (slot === 0) {
    if (phase === "Aufbau") return short
      ? { type: "interval", title: "Intervalle 1000 m", km: r1(10 * scale), zone: "Z5", detail: `2 km einlaufen, 5 × 1000 m in ${P("i")}, 3 min Trabpause, auslaufen` }
      : { type: "tempo", title: "Schwelle 3 × 10 min", km: r1(12 * scale), zone: "Z4", detail: `2 km einlaufen, 3 × 10 min in ${P("t")}, 2 min Trabpause, auslaufen` };
    return d === 5000
      ? { type: "interval", title: "Intervalle 800 m", km: r1(10 * scale), zone: "Z5", detail: `2 km einlaufen, 6 × 800 m in ${P("i")}, 2:30 min Trab, auslaufen` }
      : d === 10000
        ? { type: "interval", title: "Intervalle 1600 m", km: r1(12 * scale), zone: "Z4–5", detail: `2 km einlaufen, 4 × 1600 m in ${P("i")}, 3 min Trab, auslaufen` }
        : { type: "tempo", title: "Tempodauerlauf", km: r1(14 * scale), zone: "Z4", detail: `2 km einlaufen, 2 × 4 km in ${P("t")}, 3 min Trab, auslaufen` };
  }
  return short
    ? { type: "tempo", title: "Schwelle 4 × 6 min", km: r1(10 * scale), zone: "Z4", detail: `2 km einlaufen, 4 × 6 min in ${P("t")}, 90 s Trab, auslaufen` }
    : { type: "interval", title: "Intervalle 1000 m", km: r1(11 * scale), zone: "Z5", detail: `2 km einlaufen, 5 × 1000 m in ${P("i")}, 3 min Trab, auslaufen` };
}

/** Mit festem Intervall-Tag: dort immer Intervalle (schon in der Grundlage), der zweite harte Tag ist Schwelle */
function fixedQuality(phase: Phase, d: number, slot: number, p: Paces | null, scale: number): Omit<Session, "date"> {
  const P = (k: "t" | "i") => (p ? range(p, k) : k === "t" ? "Zone 4 („angenehm schwer“)" : "Zone 5 (zügig)");
  const own = " Oder dein festes Intervalltraining.";
  const short = d <= 10000;
  if (slot === 0) {
    if (phase === "Grundlage" || phase === "Erhalt") return { type: "interval", title: "Intervalle 6 × 3 min", km: r1(9 * scale), zone: "Z5", detail: `2 km einlaufen, 6 × 3 min in ${P("i")}, 2 min Trab, auslaufen.${own}` };
    if (phase === "Taper") return { type: "interval", title: "Kurz und knackig", km: r1(7 * scale), zone: "Z4–5", detail: `2 km einlaufen, 4 × 400 m in ${P("i")}, 200 m Trab, auslaufen` };
    if (phase === "Aufbau" || d === 10000) return { type: "interval", title: "Intervalle 1000 m", km: r1(10 * scale), zone: "Z5", detail: `2 km einlaufen, 5 × 1000 m in ${P("i")}, 3 min Trab, auslaufen.${own}` };
    return d === 5000
      ? { type: "interval", title: "Intervalle 800 m", km: r1(10 * scale), zone: "Z5", detail: `2 km einlaufen, 6 × 800 m in ${P("i")}, 2:30 min Trab, auslaufen.${own}` }
      : { type: "interval", title: "Intervalle 2000 m", km: r1(12 * scale), zone: "Z4", detail: `2 km einlaufen, 4 × 2000 m in ${P("t")}, 2 min Trab, auslaufen.${own}` };
  }
  if (short || phase === "Aufbau") return short
    ? { type: "tempo", title: "Schwelle 4 × 6 min", km: r1(10 * scale), zone: "Z4", detail: `2 km einlaufen, 4 × 6 min in ${P("t")}, 90 s Trab, auslaufen` }
    : { type: "tempo", title: "Schwelle 3 × 10 min", km: r1(12 * scale), zone: "Z4", detail: `2 km einlaufen, 3 × 10 min in ${P("t")}, 2 min Trab, auslaufen` };
  return { type: "tempo", title: "Tempodauerlauf", km: r1(14 * scale), zone: "Z4", detail: `2 km einlaufen, 2 × 4 km in ${P("t")}, 3 min Trab, auslaufen` };
}

/** Plan aus Ziel und aktueller Form. Beginnt am Montag der Woche, in der er angelegt wurde. */
export function buildPlan(goal: Goal, cur: Current): Plan {
  const days = Math.max(3, Math.min(6, Math.round(goal.days || 4)));
  const start = monday(goal.created);
  const race = goal.kind === "race" && goal.dist && goal.date ? { d: goal.dist, date: goal.date } : null;
  const nWeeks = race ? Math.max(4, Math.min(24, Math.floor((Date.parse(monday(race.date) + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / (7 * 864e5)) + 1)) : 8;
  const d = race ? race.d : 10000;
  const feas = race ? feasibility(cur.vdot, d, nWeeks, goal.target, cur.pen || 0) : feasibility(cur.vdot, 10000, 0, null);
  // Trainingstempo: aktuelle Form, bei Wunschzeit leicht in Richtung Ziel (höchstens halber Weg, damit es nicht zu hart wird)
  const tv = race && goal.target && cur.vdot != null ? vdotFromRace(d, goal.target) : null;
  const vdotFor = (w: number) => (cur.vdot == null ? null : tv == null || tv <= cur.vdot ? cur.vdot : cur.vdot + Math.min(tv - cur.vdot, vdotGain(cur.vdot, nWeeks)) * (w / Math.max(1, nWeeks - 1)) * 0.5);
  // Umfang: Start = heutiger Umfang (mind. 4 km je Lauftag), Ziel = Spitze für die Strecke, angepasst an die Lauftage
  const startKm = Math.max(goal.startKm || cur.weekKm || 0, days * 4);
  // Spitze: eigene Vorgabe oder Strecke × Lauftage × Form (schnellere Läufer vertragen und brauchen mehr Umfang,
  // VDOT 50 = Grundwert, je Punkt +2,5 %, 0,8- bis 1,4-fach)
  const formFactor = cur.vdot == null ? 1 : Math.max(0.8, Math.min(1.4, 1 + (cur.vdot - 50) * 0.025));
  const peakKm = goal.peak ? Math.max(startKm, goal.peak) : Math.max(startKm, (PEAK[d] || 45) * (days / 5) * formFactor * (race ? 1 : 0.8));
  const taper = race ? (d >= 21097 ? 2 : 1) : 0;
  const lay = dayLayout(days, goal.longDay, goal.hardDay);
  const fixed = goal.hardDay != null && lay.hard[0] === goal.hardDay;
  const pauses = goal.pauses || [];
  const inPause = (day: string) => pauses.some((x) => day >= x.from && day <= x.to);
  const weeks: Week[] = [];
  let km = startKm;
  // langer Lauf wächst höchstens 2 km pro Woche (leichte Wochen zählen nicht)
  let prevLong = Math.min(cur.longKm || startKm * 0.3, startKm * 0.4);
  for (let w = 0; w < nWeeks; w++) {
    const fromEnd = nWeeks - 1 - w;
    let phase: Phase;
    // Taper = die letzten 1 (5/10 km) bzw. 2 Wochen (HM/Marathon) inkl. Wettkampfwoche; davor 40 % Grundlage, 40 % Aufbau, 20 % Spitze
    if (!race) phase = "Erhalt";
    else if (fromEnd < taper) phase = "Taper";
    else { const pos = w / Math.max(1, nWeeks - taper); phase = pos < 0.4 ? "Grundlage" : pos < 0.8 ? "Aufbau" : "Spitze"; }
    const easyWeek = phase !== "Taper" && w > 0 && (w + 1) % 4 === 0;
    const ws = addDays(start, w * 7);
    // Pause: überwiegend pausierte Woche → Umfang wächst nicht. Danach Wiedereinstieg: krank 70 % / 85 %, Urlaub 85 % / 93 %
    let pausedDays = 0;
    for (let i = 0; i < 7; i++) if (inPause(addDays(ws, i))) pausedDays++;
    const after = pauses.filter((x) => x.to < ws && x.to >= addDays(ws, -14)).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    const back = !after ? 1 : after.to >= addDays(ws, -7) ? (after.kind === "krank" ? 0.7 : 0.85) : after.kind === "krank" ? 0.85 : 0.93;
    const comeback = back < 1 && pausedDays < 4;
    if (w > 0 && phase !== "Taper" && !easyWeek && pausedDays < 4 && back === 1) km = Math.min(peakKm, km * 1.08);
    let weekKm = (easyWeek ? km * 0.8 : km) * (pausedDays < 4 ? back : 1);
    if (phase === "Taper") weekKm = km * (fromEnd === 0 ? 0.5 : 0.7);
    if (!race) weekKm = easyWeek ? startKm * 0.85 : Math.min(peakKm, startKm * (1 + 0.04 * (w % 4)));
    const p = (() => { const v = vdotFor(w); return v == null ? null : paces(v, cur.hr); })();
    const sessions: Session[] = [];
    // Länge der harten Einheiten wächst mit dem Umfang, bleibt aber unter der Grundlänge (sonst werden die lockeren Läufe zu kurz)
    const scale = Math.max(0.6, Math.min(1.25, weekKm / ((PEAK[d] || 45) * (days / 5))));
    // harte Einheiten: Grundlage 1 (Steigerungen), sonst 2 ab 4 Lauftagen; leichte Woche nur 1
    // Wiedereinstieg: höchstens eine harte Einheit, direkt nach Krankheit gar keine
    const sick = comeback && after!.kind === "krank" && back <= 0.7;
    const hardN = sick ? 0 : Math.min(lay.hard.length, phase === "Grundlage" || easyWeek || phase === "Taper" || comeback ? 1 : days >= 4 ? 2 : 1);
    lay.hard.slice(0, hardN).forEach((day, i) => {
      const q: Session = { date: addDays(ws, day), ...(fixed ? fixedQuality(phase, d, i, p, scale) : quality(phase, d, i, p, scale)) };
      // fürs Abhaken: Anzahl Wiederholungen („5 × 1000 m“) und Zielpace (Schwelle bzw. Intervalle)
      const reps = Number(/(\d+) ×/.exec(q.detail)?.[1]);
      if ((q.type === "tempo" || q.type === "interval") && reps) { q.reps = reps; if (p) q.pace = q.type === "tempo" || /2000 m/.test(q.title) ? p.t : p.i; }
      sessions.push(q);
    });
    // Wettkampfwoche: Rennen statt langem Lauf
    const raceThisWeek = race && w === nWeeks - 1;
    if (raceThisWeek) {
      sessions.push({ date: race!.date, type: "race", title: "Wettkampf " + (d === 21097 ? "Halbmarathon" : d === 42195 ? "Marathon" : d / 1000 + " km"), km: r1(d / 1000), zone: "",
        detail: goal.target ? "Ziel " + clock(goal.target) + " · Pace ~" + pace(goal.target / (d / 1000)) + " /km" : feas.suggest ? "Realistisch: " + clock(feas.suggest) + " · Viel Erfolg!" : "Viel Erfolg!" });
    } else {
      const longKm = Math.min(LONG_MAX[d] || 20, Math.max(Math.min(cur.longKm || 0, weekKm * 0.4), weekKm * (phase === "Grundlage" || !race ? 0.27 : LONG_SHARE[d] || 0.3)), prevLong + 2);
      if (!easyWeek) prevLong = Math.max(prevLong, longKm);
      const mp = race && d >= 21097 && phase === "Spitze" && !easyWeek;
      sessions.push({ date: addDays(ws, lay.long), type: mp ? "mp" : "long", title: mp ? "Langer Lauf mit Wettkampftempo" : "Langer Lauf", km: r1(longKm), zone: "Z2",
        detail: mp && p ? `Locker ${range(p, "e")}, die letzten ${Math.round(longKm * 0.35)} km im Wettkampftempo ${pace((d === 42195 ? p.m : p.t + 8) - 3)}–${pace((d === 42195 ? p.m : p.t + 8) + 3)} /km` : `Gleichmäßig locker ${p ? range(p, "e") : "in Zone 2"}` });
    }
    const used = sessions.reduce((s, x) => s + x.km, 0);
    // nicht genutzte harte Tage (Grundlage, leichte Woche, Taper) werden lockere Läufe
    const rest = [...lay.easy, ...lay.hard.slice(hardN)].sort((a, b) => a - b).filter((day) => !raceThisWeek || addDays(ws, day) < race!.date);
    const each = rest.length ? Math.max(4, (weekKm - used) / rest.length) : 0;
    for (const day of rest) sessions.push({ date: addDays(ws, day), type: "easy", title: "Locker", km: r1(raceThisWeek ? Math.min(each, 6) : each), zone: "Z2", detail: `Locker ${p ? range(p, "e") : "in Zone 2"}` });
    // Verschieben: nur innerhalb der Woche, ein belegter Tag wird getauscht; der Wettkampf bleibt
    const end = addDays(ws, 6);
    for (const [from, to] of Object.entries(goal.moves || {})) {
      if (from === to || from < ws || from > end || to < ws || to > end) continue;
      const a = sessions.find((x) => x.date === from && !x.moved), b = sessions.find((x) => x.date === to && !x.moved);
      if (!a || a.type === "race" || b?.type === "race") continue;
      a.date = to; a.moved = true;
      if (b) { b.date = from; b.moved = true; }
    }
    // Pause: Einheiten an diesen Tagen fallen weg
    const kept = sessions.filter((x) => !inPause(x.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const pz = pausedDays ? pauses.find((x) => x.to >= ws && x.from <= end) : null;
    weeks.push({ start: ws, phase, km: r1(kept.reduce((s, x) => s + x.km, 0)), easy: easyWeek, sessions: kept, ...(pz ? { pause: pz.kind } : {}), ...(comeback ? { comeback: true } : {}) });
  }
  return { weeks, paces: cur.vdot == null ? null : paces(cur.vdot, cur.hr), feas, vdot: cur.vdot, targetVdot: tv };
}

// ---------- Abhaken ----------
/**
 * Geplante Einheiten mit gelaufenen abgleichen (ändert die Sitzungen des Plans):
 * zuerst gleicher Tag, dann ±1 Tag (getauscht). Erfüllung in Prozent:
 *  - locker/lang: Strecke zum Plan × Puls (Zeit über dem lockeren Bereich kostet bis zur Hälfte)
 *  - Schwelle/Intervalle: schnellste Runden = Wiederholungen; Anteil geschafft × Pace zum Ziel (bis 2 % langsamer zählt voll)
 * Vergangene Einheiten ohne Lauf = verpasst, außer selbst abgehakt.
 */
export function checkOff(plan: Plan, runs: DoneRun[], today: string, manual: string[] = []): void {
  const z2 = plan.paces?.hr?.z2 || null;
  const all = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.date <= today);
  const used = new Set<string>();
  const byDay = new Map<string, DoneRun[]>();
  for (const r of runs) if (r.km > 0.5) byDay.set(r.date, [...(byDay.get(r.date) || []), r]);
  const pick = (s: Session, day: string) => {
    const c = (byDay.get(day) || []).filter((r) => !used.has(r.id));
    return c.sort((a, b) => Math.abs(a.km - s.km) - Math.abs(b.km - s.km))[0];
  };
  const match = new Map<Session, DoneRun>();
  for (const s of all) { const r = pick(s, s.date); if (r) { used.add(r.id); match.set(s, r); } }
  for (const s of all) {
    if (match.has(s) || s.date >= today) continue;
    const r = pick(s, addDays(s.date, -1)) || pick(s, addDays(s.date, 1));
    if (r) { used.add(r.id); match.set(s, r); }
  }
  for (const s of all) {
    const r = match.get(s);
    if (r) s.done = { id: r.id, km: r.km, sec: Math.round(r.min * 60), ...score(s, r, z2) };
    else if (manual.includes(s.date)) s.done = { id: null, pct: null, why: "selbst abgehakt", km: null, sec: null, manual: true };
    else if (s.date < today) s.missed = true;
  }
}

const fmtKm = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

function score(s: Session, r: DoneRun, z2: [number, number] | null): { pct: number | null; why: string } {
  if (s.type === "race") return { pct: null, why: "Wettkampf gelaufen" };
  const laps = (r.laps || []).filter((l) => (l.v || 0) > 0 && (l.s || 0) > 0);
  const why: string[] = [];
  if ((s.type === "tempo" || s.type === "interval") && s.reps && s.pace) {
    // schnellste Runden ab 1 Minute als Wiederholungen
    const fast = laps.filter((l) => (l.s as number) >= 60).sort((a, b) => (b.v as number) - (a.v as number)).slice(0, s.reps);
    if (fast.length) {
      const sec = fast.reduce((t, l) => t + (l.s as number), 0), m = fast.reduce((t, l) => t + (l.m || (l.v as number) * (l.s as number)), 0);
      const p = sec / (m / 1000), slow = (p - s.pace) / s.pace;
      const repPart = Math.min(1, fast.length / s.reps), pacePart = slow <= 0.02 ? 1 : 1 - Math.min(0.6, (slow - 0.02) * 4);
      if (fast.length < s.reps) why.push(fast.length + " von " + s.reps + " Wiederholungen");
      why.push(slow <= 0.02 ? "Tempo getroffen" : Math.round(slow * 100) + " % langsamer als geplant");
      return { pct: Math.round(100 * repPart * pacePart), why: why.join(" · ") };
    }
    why.push("keine Runden, nach Strecke bewertet");
  }
  const dist = Math.min(1, r.km / Math.max(0.5, s.km));
  if (r.km < s.km - 0.5) why.push(fmtKm(s.km - r.km) + " km kürzer");
  else if (r.km > s.km * 1.3) why.push(fmtKm(r.km - s.km) + " km länger");
  let hrPen = 0;
  if (z2 && (s.type === "easy" || s.type === "long" || s.type === "strides" || s.type === "mp")) {
    const lim = z2[1] + 2;
    let over = 0, tot = 0;
    if (laps.some((l) => l.hr)) for (const l of laps) { if (!l.hr) continue; tot += l.s as number; if (l.hr > lim) over += l.s as number; }
    else if (r.hr) { tot = 1; over = r.hr > lim ? 1 : 0; }
    // Wettkampftempo am Ende des langen Laufs darf darüber liegen
    const share = tot ? over / tot : 0, allowed = s.type === "mp" ? 0.4 : s.type === "strides" ? 0.1 : 0;
    hrPen = Math.max(0, share - allowed) * 0.5;
    if (share - allowed > 0.1) why.push("Puls " + Math.round((share - allowed) * 100) + " % der Zeit über dem lockeren Bereich");
  }
  if (!why.length) why.push("wie geplant");
  return { pct: Math.round(100 * dist * (1 - hrPen)), why: why.join(" · ") };
}
