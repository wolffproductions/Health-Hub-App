// Wettkampfprognosen (#74, #83, #85, #105): eine Rechnung für alle Trainingsarten.
// Reine Funktionen ohne Importe, getestet in test/prognose.test.ts. /api/data liefert das Ergebnis fertig
// (wie die Ampel), die Oberfläche und der Claude-Zugang zeigen es nur an.
//
// Quellen (jede schätzt eine VO2max):
//  1. Garmins VO2max (bzw. eigener Eintrag unter Konto), der neueste Wert fürs Laufen.
//  2. Form aus Läufen: aus Tempo (steigungsbereinigt) und Puls je Lauf ab 3 km und je Runde ab 6 Minuten der letzten
//     6 Wochen. Anteil an der Herzfrequenzreserve ≈ Anteil an der VO2-Reserve (Swain). Nur 70–97 % der Reserve.
//  3. Intervalle über das Tempo: 5-km-Zeit ≈ Tempo der schnellen Runden plus Aufschlag für die Pausen, daraus die
//     VO2max nach Daniels. Nur echte Intervalle (siehe intervalSessions): Auto-Runden eines normalen Laufs zählen nicht.
//  4. Harte Zeit (Wettkampf oder Testlauf) der letzten 8 Wochen: schnellster Abschnitt über 5 km, 10 km, HM oder M
//     aus einem Lauf mit hohem Puls (mind. 88 % vom Maximalpuls), in Strava als Wettkampf markiert oder schneller als Garmins VO2max. Zählt am stärksten,
//     ohne Abweichungs-Grenze (eine gelaufene Zeit ist kein Messfehler), und die Prognose für dieselbe Strecke ist nie
//     langsamer als diese Zeit.
// Zusammenführen: je Strecke gewichtet (PRED_WEIGHTS) × Vertrauen (Menge, Aktualität, Sicherheit der Erkennung).
// Weicht eine eigene Schätzung zu weit von Garmin ab (Form > 10 %, Intervalle > 15 %), zählt sie nicht mit
// (eher ein Messproblem als echte Form). Ausdauer-Aufschlag für Halbmarathon und Marathon bei wenig Umfang.

export interface PLap { hr?: number | null; v?: number | null; s?: number | null; m?: number | null; it?: number | null; tg?: number | null }
export interface PAct {
  date: string; type?: string | null; km?: number | null; min?: number | null; hr?: number | null; maxHr?: number | null;
  gap?: number | null; spd?: number | null; vo2?: number | null; laps?: PLap[] | null;
  f5k?: number | null; f10k?: number | null; fHm?: number | null; fM?: number | null;
  /** in Strava als Wettkampf markiert */
  race?: boolean;
}
export interface PDay { d: string; rhr?: number | null }
export interface PVo2 { d: string; sport: string; v: number }
export type PredMode = "auto" | "garmin" | "intervalle";
export interface PredInput { today: string; acts: PAct[]; days: PDay[]; manualVo2?: PVo2[]; hrMax?: number | null; mode?: PredMode }

export type SourceKey = "garmin" | "form" | "intervalle" | "wettkampf";
export interface PredSource {
  key: SourceKey; vo2: number; used: boolean; conf: number;
  /** kurze Marke für die Anzeige, z. B. „Garmin-VO2max 53“ */
  label: string;
  /** Erklärung (warum mitgezählt bzw. weggelassen) */
  why: string;
}
export interface PredRace { label: string; d: number; sec: number; pace: number; lo: number | null; hi: number | null; penalty: number; vo2: number }
export interface Prognose {
  mode: PredMode;
  races: PredRace[];
  sources: PredSource[];
  /** längster Lauf (km) und Wochenumfang (km) der letzten 8 Wochen */
  volume: { long: number; week: number };
  /** Vergleich: schnellste Abschnitte der letzten 8 Wochen nach Riegel (Sekunden je Strecke) */
  riegel: Array<number | null>;
  /** true = keine VO2max-Quelle, Zeiten nur grob aus den schnellsten Abschnitten */
  rough: boolean;
}

export const RACES: Array<[string, number, "f5k" | "f10k" | "fHm" | "fM"]> = [
  ["5 km", 5000, "f5k"], ["10 km", 10000, "f10k"], ["Halbmarathon", 21097.5, "fHm"], ["Marathon", 42195, "fM"],
];
const FORM_DAYS = 42, VOL_DAYS = 56;
/** Gewichte je Strecke: [Garmin, Form, Intervalle, harte Zeit]. Kurz = Intervalle zählen mehr, lang = ruhige Läufe.
 *  Eine harte Zeit zählt am meisten, am stärksten für die eigene Strecke (siehe RACE_SAME). */
export const PRED_WEIGHTS: Record<number, [number, number, number, number]> = {
  5000: [1, 1, 2, 3], 10000: [1, 1, 1.5, 3], 21097.5: [1, 1.5, 1, 2], 42195: [1, 2, 0.5, 1.5],
};
/** Zusatzgewicht, wenn die harte Zeit über genau diese Strecke gelaufen wurde */
const RACE_SAME = 2;
/** Ab diesem Anteil vom Maximalpuls (Schnitt der Einheit) gilt ein Lauf als hart */
const HARD_HR = 0.88;
/**
 * Ab diesem längsten Lauf / Wochenumfang (km) gilt die Ausdauer als gedeckt; maxPen = Aufschlag ganz ohne Umfang,
 * wWeek = Gewicht des Wochenumfangs (Rest: langer Lauf). Beim Marathon zählt der Umfang mehr als ein einzelner langer Lauf.
 */
const ENDURANCE: Record<number, { long: number; week: number; maxPen: number; wWeek: number }> = {
  21097.5: { long: 18, week: 55, maxPen: 0.08, wWeek: 0.4 }, 42195: { long: 32, week: 80, maxPen: 0.28, wWeek: 0.6 },
};
/** Höchste erlaubte Abweichung von Garmins VO2max, sonst zählt die Quelle nicht */
export const MAX_DEV = { form: 0.10, intervalle: 0.15 };

// ---------- Daniels/Gilbert ----------
/** Sauerstoffbedarf bei v m/min */
export const vo2Need = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;
/** durchhaltbarer Anteil der VO2max über t Minuten */
export const vo2Share = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
/** Zeit in Sekunden für d Meter bei gegebener VO2max */
export function raceFromVo2(vo2: number, d: number): number {
  let lo = 3, hi = 900;
  for (let k = 0; k < 50; k++) { const t = (lo + hi) / 2; if (vo2Need(d / t) / vo2Share(t) > vo2) lo = t; else hi = t; }
  return ((lo + hi) / 2) * 60;
}
/** VO2max, bei der Daniels genau diese Zeit über d Meter ergibt */
export function vo2FromRace(d: number, sec: number): number {
  let lo = 20, hi = 95;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (raceFromVo2(m, d) > sec) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------- Hilfen ----------
const dayNum = (d: string) => Date.parse(d + "T00:00:00Z") / 864e5;
const ageDays = (today: string, d: string) => dayNum(today) - dayNum(d);
const isRun = (a: PAct) => /running/.test(a.type || "");
const inLast = (today: string, d: string, days: number) => d <= today && ageDays(today, d) < days;
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number) => String(r1(x)).replace(".", ",");
/** „2026-11-10“ → „10.11.“ */
const de = (d: string) => { const [, m, dd] = d.split("-"); return Number(dd) + "." + Number(m) + "."; };
const clock = (s: number) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss; };
const pace = (sPerKm: number) => Math.floor(sPerKm / 60) + ":" + String(Math.round(sPerKm % 60)).padStart(2, "0");

/**
 * VO2max fürs Laufen: Garmin je Einheit, am selben Tag gewinnt ein eigener Eintrag. Wert = Schnitt der letzten bis zu 5
 * Werte aus den 6 Wochen bis zum neuesten (#187), damit ein lockerer Lauf die Prognose nicht um einen Punkt verschiebt.
 * d = Tag des neuesten Werts, n = Anzahl im Schnitt.
 */
export function latestVo2(acts: PAct[], manual: PVo2[] = []): { d: string; v: number; auto: boolean; n: number } | null {
  const by = new Map<string, { d: string; v: number; auto: boolean }>();
  for (const a of acts) if (isRun(a) && a.vo2) { const e = by.get(a.date); if (!e || a.vo2 > e.v) by.set(a.date, { d: a.date, v: a.vo2, auto: true }); }
  for (const e of manual) if (e.sport === "run") by.set(e.d, { d: e.d, v: e.v, auto: false });
  const all = [...by.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
  if (!all.length) return null;
  const last = all[all.length - 1];
  const from = new Date(Date.parse(last.d + "T12:00:00Z") - 42 * 864e5).toISOString().slice(0, 10);
  const w = all.filter((e) => e.d > from).slice(-5);
  return { d: last.d, v: Math.round((w.reduce((t, e) => t + e.v, 0) / w.length) * 10) / 10, auto: last.auto, n: w.length };
}

/** Maximal- und Ruhepuls: übergeben bzw. höchster Puls des letzten Jahres; Ruhepuls als Median der letzten 14 Tage */
function hrBounds(inp: PredInput) {
  let max = inp.hrMax || null;
  if (!max) for (const a of inp.acts) if (isRun(a) && a.maxHr && inLast(inp.today, a.date, 365)) max = Math.max(max || 0, a.maxHr);
  const rhrs = inp.days.filter((x) => x.rhr && inLast(inp.today, x.d, 14)).map((x) => x.rhr as number).sort((x, y) => x - y);
  const rest = rhrs.length ? rhrs[Math.floor(rhrs.length / 2)] : null;
  return max && rest && max - rest > 40 ? { max, rest } : null;
}

/** Form aus Läufen und Tempoabschnitten (gewichteter Median) */
export function formFromRuns(inp: PredInput): { v: number; runs: number; laps: number } | null {
  const hb = hrBounds(inp); if (!hb) return null;
  const est: Array<[number, number]> = [];
  let runs = 0, laps = 0;
  const add = (v: number | null | undefined, hr: number, w: number) => {
    const hrr = (hr - hb.rest) / (hb.max - hb.rest);
    if (!v || !(v > 2) || hrr < 0.7 || hrr > 0.97) return false;
    const x = 3.5 + (vo2Need(v * 60) - 3.5) / hrr;
    if (x > 25 && x < 90) { est.push([x, w]); return true; }
    return false;
  };
  for (const a of inp.acts) {
    if (!isRun(a) || !inLast(inp.today, a.date, FORM_DAYS)) continue;
    const v = a.gap || a.spd || (a.km && a.min ? (a.km * 1000) / (a.min * 60) : null);
    if ((a.km || 0) >= 3 && a.hr && add(v, a.hr, a.min || 1)) runs++;
    for (const l of a.laps || []) if ((l.s || 0) >= 360 && l.hr && add(l.v, l.hr, (l.s as number) / 60)) laps++;
  }
  if (est.length < 3) return null;
  est.sort((x, y) => x[0] - y[0]);
  const half = est.reduce((t, e) => t + e[1], 0) / 2;
  let acc = 0, med = est[est.length - 1][0];
  for (const [x, w] of est) { acc += w; if (acc >= half) { med = x; break; } }
  return { v: med, runs, laps };
}

export type Certainty = "sicher" | "manuell" | "muster";
export interface IntervalSession { d: string; v: number; t5: number; n: number; m: number; pace: number; cert: Certainty }

const WORK_IT = new Set([0, 5]); // aktiv, Intervall
const REST_IT = new Set([1, 4]); // Pause, Erholung
const AUTO_TG = new Set([1, 2]); // Auto-Runde nach Zeit oder Distanz

/**
 * Intervalle einer Einheit erkennen (#105):
 *  - sicher: Die Uhr hat Belastungs- und Erholungsrunden markiert (strukturiertes Training).
 *  - keine: Alle Runden sind Auto-Runden (jeder Kilometer eine Runde) → normaler Lauf.
 *  - manuell/muster: Runden-Taste bzw. ohne Angaben der Uhr. Dann müssen sich schnelle Runden (600–2100 m,
 *    mind. 10 % schneller als der Median) und deutlich langsamere (mind. 20 % langsamer) bzw. Stehpausen abwechseln.
 */
export function detectIntervals(laps: PLap[]): { work: PLap[]; rest: number; cert: Certainty } | null {
  const L = laps.filter((l) => (l.v || 0) > 0 && (l.s || 0) > 0);
  if (L.length < 4) return null;
  const len = (l: PLap) => l.m || (l.v as number) * (l.s as number);
  const hasIt = L.some((l) => l.it != null), hasTg = L.some((l) => l.tg != null);
  // Strukturiertes Training: Belastung und Erholung von der Uhr markiert
  if (hasIt && L.some((l) => REST_IT.has(l.it as number)) && L.some((l) => WORK_IT.has(l.it as number))) {
    const idx = L.map((l, i) => (WORK_IT.has(l.it as number) && len(l) >= 400 && len(l) <= 2100 ? i : -1)).filter((i) => i >= 0);
    // nur Belastungsrunden zwischen zwei Erholungen bzw. die von Erholung gefolgt werden (Aufwärmen/Auslaufen sind it 2/3)
    if (idx.length >= 3) {
      let rest = 0;
      for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (!idx.includes(i)) rest += L[i].s as number;
      return { work: idx.map((i) => L[i]), rest, cert: "sicher" };
    }
    return null;
  }
  // Nur Auto-Runden (die letzte, vom Ende der Einheit ausgelöste, zählt nicht): normaler Lauf, keine Intervalle
  if (hasTg) {
    const inner = L.slice(0, -1);
    if (inner.length && inner.every((l) => AUTO_TG.has(l.tg as number))) return null;
  }
  const vs = L.map((l) => l.v as number).sort((x, y) => x - y), med = vs[Math.floor(vs.length / 2)];
  const isWork = (l: PLap) => (l.v as number) >= med * 1.1 && len(l) >= 600 && len(l) <= 2100;
  const idx = L.map((l, i) => (isWork(l) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 3) return null;
  const vw = idx.reduce((t, i) => t + len(L[i]), 0) / idx.reduce((t, i) => t + (L[i].s as number), 0);
  // zwischen je zwei schnellen Runden muss eine deutlich langsamere liegen (Erholung oder Stehpause)
  for (let k = 0; k < idx.length - 1; k++) {
    const between = L.slice(idx[k] + 1, idx[k + 1]);
    if (!between.length || !between.some((l) => (l.v as number) <= vw * 0.8)) return null;
  }
  let rest = 0;
  for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (!idx.includes(i)) rest += L[i].s as number;
  const manual = hasTg && L.some((l) => l.tg === 0);
  return { work: idx.map((i) => L[i]), rest, cert: manual ? "manuell" : "muster" };
}

/** Alle Intervalleinheiten der letzten 6 Wochen mit geschätzter 5-km-Zeit und VO2max */
export function intervalSessions(inp: PredInput): IntervalSession[] {
  const out: IntervalSession[] = [];
  for (const a of inp.acts) {
    if (!isRun(a) || !inLast(inp.today, a.date, FORM_DAYS) || !a.laps) continue;
    const det = detectIntervals(a.laps);
    if (!det) continue;
    const len = (l: PLap) => l.m || (l.v as number) * (l.s as number);
    const wm = det.work.reduce((t, l) => t + len(l), 0), ws = det.work.reduce((t, l) => t + (l.s as number), 0);
    if (wm < 3000) continue;
    const vw = wm / ws, r = Math.min(1.5, det.rest / ws);
    const k = 0.025 + 0.025 * r + (Math.max(0, 5000 - wm) / 5000) * 0.03;
    const t5 = (5000 / vw) * (1 + k);
    out.push({ d: a.date, v: vo2FromRace(5000, t5), t5, n: det.work.length, m: Math.round(wm / det.work.length / 100) * 100, pace: 1000 / vw, cert: det.cert });
  }
  return out;
}

/** Längster Lauf und Wochenumfang (km) der letzten 8 Wochen */
export function volumeStats(inp: PredInput) {
  let long = 0, sum = 0;
  for (const a of inp.acts) if (isRun(a) && inLast(inp.today, a.date, VOL_DAYS)) { long = Math.max(long, a.km || 0); sum += a.km || 0; }
  return { long, week: sum / (VOL_DAYS / 7) };
}
/**
 * Aufschlag (Anteil) für fehlende Ausdauer: fehlender Anteil am Wochenumfang (Gewicht wWeek) und am langen Lauf.
 * Wurzel statt linear: schon eine kleine Lücke kostet spürbar (die Daniels-Hochrechnung setzt volle Ausdauer voraus).
 */
export function endurancePenalty(d: number, vol: { long: number; week: number }) {
  const e = ENDURANCE[d]; if (!e) return 0;
  const gapLong = Math.max(0, e.long - vol.long) / e.long, gapWeek = Math.max(0, e.week - vol.week) / e.week;
  return e.maxPen * Math.sqrt((1 - e.wWeek) * gapLong + e.wWeek * gapWeek);
}

export interface HardEffort { d: string; dist: number; label: string; sec: number; v: number }
/**
 * Beste harte Zeit der letzten 8 Wochen: schnellste Abschnitte (f5k …) aus Läufen, die hart waren (Puls mind. 88 % vom
 * Maximalpuls) oder deutlich auf Garmins VO2max-Niveau liegen. Lockere Läufe mit Bestzeit-Abschnitt zählen so nicht.
 * Mehr als 20 % über Garmin = vermutlich GPS-Fehler, ausgelassen.
 */
export function hardEfforts(inp: PredInput, garmin: number | null): HardEffort[] {
  const out: HardEffort[] = [];
  for (const a of inp.acts) {
    if (!isRun(a) || !inLast(inp.today, a.date, VOL_DAYS)) continue;
    const hard = !!a.race || !!(a.hr && inp.hrMax && a.hr >= HARD_HR * inp.hrMax);
    for (const [label, d, k] of RACES) {
      const t = a[k]; if (!t) continue;
      const v = vo2FromRace(d, t);
      if (garmin && v > garmin * 1.2) continue;
      if (hard || (garmin != null && v >= garmin)) out.push({ d: a.date, dist: d, label, sec: t, v });
    }
  }
  return out;
}

const CERT_CONF: Record<Certainty, number> = { sicher: 1, manuell: 0.85, muster: 0.6 };
const CERT_TEXT: Record<Certainty, string> = { sicher: "von der Uhr als Intervalle markiert", manuell: "mit der Runden-Taste gelaufen", muster: "am Wechsel schnell/langsam erkannt" };

export function prognose(inp: PredInput): Prognose {
  const mode: PredMode = inp.mode || "auto";
  const vol = volumeStats(inp);
  // Vergleich: schnellste Abschnitte der letzten 8 Wochen, auf jede Distanz umgerechnet (Riegel), das beste zählt
  const recent = inp.acts.filter((a) => isRun(a) && inLast(inp.today, a.date, VOL_DAYS));
  const riegel = RACES.map(([, d]) => {
    let best: number | null = null;
    for (const a of recent) for (const [, d1, k] of RACES) { const t1 = a[k]; if (t1) { const t = t1 * (d / d1) ** 1.06; if (best == null || t < best) best = t; } }
    return best;
  });

  const sources: PredSource[] = [];
  const g = latestVo2(inp.acts, inp.manualVo2);
  if (g) {
    const age = ageDays(inp.today, g.d);
    sources.push({ key: "garmin", vo2: g.v, used: true, conf: age > 60 ? 0.7 : 1, label: "Garmin-VO2max " + fmt(g.v),
      why: (g.n > 1 ? "Schnitt deiner letzten " + g.n + " VO2max-Werte bis " : g.auto ? "Garmins VO2max vom " : "Dein Eintrag vom ") + de(g.d) + (age > 60 ? " Schon über zwei Monate alt, deshalb zählt er etwas weniger." : "") });
  }
  const dev = (x: number) => (g ? Math.abs(x - g.v) / g.v : 0);

  if (mode !== "garmin") {
    const form = formFromRuns(inp);
    if (form) {
      const n = form.runs + form.laps;
      const off = g != null && dev(form.v) > MAX_DEV.form;
      sources.push({ key: "form", vo2: form.v, used: !off, conf: Math.min(1, n / 8), label: "Form aus Läufen " + fmt(form.v),
        why: off
          ? `Deine Läufe ergeben ${fmt(form.v)}, das passt nicht zu Garmins ${fmt(g!.v)}. Wahrscheinlich sind Ruhe- oder Maximalpuls ungenau, deshalb zählt das nicht mit.`
          : `Aus Tempo und Puls von ${form.runs} ${form.runs === 1 ? "Lauf" : "Läufen"}${form.laps ? ` und ${form.laps} Tempoabschnitten` : ""} der letzten 6 Wochen.` });
    }
    // Harte Zeit: die beste (nach VO2max × Aktualität), 8 Wochen alt = halb so viel Vertrauen
    const eff = hardEfforts(inp, g ? g.v : null);
    if (eff.length) {
      const sc = (e: HardEffort) => e.v * (1 - 0.5 * Math.min(1, ageDays(inp.today, e.d) / VOL_DAYS));
      const best = eff.reduce((a, b) => (sc(b) > sc(a) ? b : a));
      // Eine harte Zeit zeigt, was mindestens geht: Sie macht die Prognose schneller, nie langsamer.
      // Liegt sie unter Garmins VO2max (Hitze, Hügel, kein Renntempo), zählt sie nicht.
      const slower = g != null && best.v < g.v;
      sources.push({ key: "wettkampf", vo2: best.v, used: !slower, conf: 1 - 0.5 * Math.min(1, ageDays(inp.today, best.d) / VOL_DAYS),
        label: "Harte Zeit " + best.label + " " + clock(best.sec),
        why: slower
          ? `${best.label} in ${clock(best.sec)} am ${de(best.d)}, entspricht ${fmt(best.v)}. Das liegt unter Garmins ${fmt(g!.v)}, war also vermutlich kein volles Renntempo, deshalb zählt es nicht.`
          : `${best.label} in ${clock(best.sec)} am ${de(best.d)}, entspricht ${fmt(best.v)}. Eine gelaufene Zeit zählt am stärksten, und die Prognose über ${best.label} ist nicht langsamer als diese Zeit.` });
    }
    const ses = intervalSessions(inp);
    if (ses.length) {
      // Vertrauen: Sicherheit der Erkennung × Aktualität (6 Wochen alt = halb so viel) × Menge (1 Einheit 0,6, ab 4 voll)
      const scored = ses.map((s) => ({ s, c: (mode === "intervalle" ? Math.max(0.8, CERT_CONF[s.cert]) : CERT_CONF[s.cert]) * (1 - 0.5 * Math.min(1, ageDays(inp.today, s.d) / FORM_DAYS)) }));
      const best = scored.reduce((a, b) => (b.s.v * b.c > a.s.v * a.c ? b : a));
      const conf = best.c * Math.min(1, 0.5 + 0.125 * ses.length);
      const s = best.s;
      let v = s.v, used = true, note = "";
      if (g && dev(s.v) > MAX_DEV.intervalle) {
        if (mode === "intervalle") { v = Math.min(g.v * (1 + MAX_DEV.intervalle), Math.max(g.v * (1 - MAX_DEV.intervalle), s.v)); note = " Weicht stark von Garmin ab, auf deine Einstellung hin trotzdem gezählt (höchstens 15 % entfernt)."; }
        else { used = false; note = ` Das passt nicht zu Garmins ${fmt(g.v)}, deshalb zählt es nicht mit. Unter Konto → Prognose kannst du „Mit meinen Intervallen“ wählen.`; }
      }
      sources.push({ key: "intervalle", vo2: v, used, conf, label: `Intervalle ${s.n} × ${s.m.toLocaleString("de-DE")} m`,
        why: `${s.n} × ${s.m.toLocaleString("de-DE")} m in ${pace(s.pace)}/km am ${de(s.d)} (${CERT_TEXT[s.cert]}), 5 km also etwa ${pace(s.t5)}, geschätzt ${fmt(s.v)}.` + note });
    }
  }

  const usedSrc = sources.filter((s) => s.used);
  const order: SourceKey[] = ["garmin", "form", "intervalle", "wettkampf"];
  const raceEff = mode !== "garmin" && usedSrc.some((s) => s.key === "wettkampf") ? hardEfforts(inp, (sources.find((s) => s.key === "garmin") || null)?.vo2 ?? null) : [];
  const races: PredRace[] = [];
  if (usedSrc.length) {
    for (const [label, d] of RACES) {
      const w = PRED_WEIGHTS[d];
      let sw = 0, sx = 0;
      for (const s of usedSrc) {
        // Harte Zeit über genau diese Strecke zählt zusätzlich mehr
        const same = s.key === "wettkampf" && raceEff.some((e) => e.dist === d && Math.abs(e.v - s.vo2) < 1e-9) ? RACE_SAME : 1;
        const ww = w[order.indexOf(s.key)] * s.conf * same; sw += ww; sx += ww * s.vo2;
      }
      const vo2 = sx / sw, pen = endurancePenalty(d, vol);
      let sec = raceFromVo2(vo2, d) * (1 + pen);
      // Nie langsamer als eine harte Zeit über dieselbe Strecke in den letzten 8 Wochen
      const own = raceEff.filter((e) => e.dist === d).reduce((m, e) => Math.min(m, e.sec), Infinity);
      if (own < sec) sec = own;
      // Spanne, wenn die verwendeten Quellen auseinanderliegen (mehr als 1,5 Punkte)
      const vs = usedSrc.map((s) => s.vo2), lo = Math.min(...vs), hi = Math.max(...vs);
      const spread = hi - lo > 1.5;
      races.push({ label, d, sec, pace: sec / (d / 1000), vo2: r1(vo2), penalty: pen,
        lo: spread ? raceFromVo2(hi, d) * (1 + pen) : null, hi: spread ? raceFromVo2(lo, d) * (1 + pen) : null });
    }
  } else if (riegel.some((t) => t != null)) {
    RACES.forEach(([label, d], i) => { const t = riegel[i]; if (t != null) races.push({ label, d, sec: t, pace: t / (d / 1000), vo2: r1(vo2FromRace(d, t)), penalty: 0, lo: null, hi: null }); });
  }
  return { mode, races, sources, volume: { long: r1(vol.long), week: r1(vol.week) }, riegel, rough: !usedSrc.length };
}
