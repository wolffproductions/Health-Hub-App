// Erholungs-Ampel (#13): eine Regel für Oberfläche („Heute“) und Morgen-Push, damit beide immer dasselbe sagen.
// Eigene, offengelegte Regel (Garmins Training Readiness gibt es über die Personal API nicht):
//   HRV-Wochenschnitt gegen Garmins Normalbereich (einzelne Nacht höchstens gelb) · Ruhepuls gegen den eigenen
//   30-Tage-Median · Schlafscore und Schlafdauer ·
//   Trainingslast akut (7 Tage) zu chronisch (28 Tage) · Erholungszeit nach harten Einheiten (#107) ·
//   Body Battery beim Aufwachen (wenn Garmin sie liefert) · WHOOP-Recovery (#119, wenn vorhanden)
// HRV ohne eigenen Normalbereich der Quelle (z. B. WHOOP, #119): Bereich und Wochenschnitt aus den eigenen Nächten
// derselben Quelle (siehe `hrvBaseline`).
// Bewusst ohne Importe, damit die Tests die Datei direkt laden können
const addDays = (date: string, n: number) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

type Day = Record<string, any> & { d: string };
export type Light = "g" | "y" | "r" | "";
/** actId: Einheit, auf die sich der Punkt bezieht (Erholung nach Training), zum Öffnen auf „Heute“ (#157) */
export interface AmpelItem { key: string; st: Light; name: string; val: string; why: string; actId?: string }
/** Baustein der Bereitschaft: pts von max Punkten (alle max zusammen = 100) */
export interface ReadyPart { key: string; name: string; pts: number; max: number }
/** score = Bereitschaft 0–100 (eigene Schätzung, keine Garmin Training Readiness), passt immer zur Farbe der Ampel */
export interface Ampel { day: string; light: Light; verdict: string; items: AmpelItem[]; score?: number | null; parts?: ReadyPart[] }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Gewichte der Bausteine (wie Garmins Training Readiness: Schlaf, HRV, Erholungszeit, Last; dazu Ruhepuls, Body Battery) */
export const READY_W = { hrv: 25, sleep: 25, recovery: 20, load: 15, rhr: 10, bb: 5 } as const;
/**
 * Bereitschaft 0–100 aus den Werten der Ampel. Fehlende Bausteine fallen heraus, die anderen werden hochgerechnet.
 * Danach in den Bereich der Ampelfarbe gelegt (grün 70–100, gelb 40–69, rot 0–39), damit Zahl und Farbe nie widersprechen.
 */
export function readiness(x: { hrv?: number | null; hrvWk?: number | null; hrvLo?: number | null; rec?: number | null; score?: number | null; slp?: number | null;
  recH?: number | null; ratio?: number | null; rhr?: number | null; rhrBase?: number | null; bb?: number | null }, light: Light): { score: number | null; parts: ReadyPart[] } {
  const raw: Array<[keyof typeof READY_W, string, number]> = [];
  // HRV: Wochenschnitt im Normalbereich = voll, 20 % darunter = nichts; eine schlechte Nacht kostet höchstens 20 %. WHOOP-Recovery ersetzt sie.
  if (x.rec != null) raw.push(["hrv", "WHOOP-Recovery", clamp01(x.rec / 100)]);
  else if (x.hrv != null && x.hrvLo != null && x.hrvLo > 0) {
    const ref = x.hrvWk ?? x.hrv;
    let v = ref >= x.hrvLo ? 1 : clamp01(1 - (x.hrvLo - ref) / (0.2 * x.hrvLo));
    if (x.hrv < x.hrvLo) v = clamp01(v - 0.2);
    raw.push(["hrv", "HRV", v]);
  }
  // Schlaf: Score 0–100, unter 7 Stunden je Stunde 10 % weniger
  if (x.score != null || x.slp != null) {
    const base = x.score != null ? x.score / 100 : clamp01((x.slp as number) / 8);
    raw.push(["sleep", "Schlaf", clamp01(base * (x.slp != null && x.slp < 7 ? 1 - (7 - x.slp) * 0.1 : 1))]);
  }
  if (x.recH != null) raw.push(["recovery", "Erholung nach Training", clamp01(1 - x.recH / 48)]);
  if (x.ratio != null) raw.push(["load", "Last", x.ratio > 1.3 ? clamp01(1 - (x.ratio - 1.3) / 0.7) : x.ratio < 0.8 ? clamp01(1 - (0.8 - x.ratio) * 0.5) : 1]);
  if (x.rhr != null && x.rhrBase != null) raw.push(["rhr", "Ruhepuls", clamp01(1 - Math.max(0, x.rhr - x.rhrBase) / 5)]);
  if (x.bb != null) raw.push(["bb", "Body Battery", clamp01(x.bb / 100)]);
  if (raw.length < 2 || !light) return { score: null, parts: [] };
  const wsum = raw.reduce((t, [k]) => t + READY_W[k], 0);
  const parts = raw.map(([k, name, v]) => { const max = (READY_W[k] / wsum) * 100; return { key: k, name, pts: Math.round(v * max), max: Math.round(max) }; });
  let score = Math.round(raw.reduce((t, [k, , v]) => t + READY_W[k] * v, 0) / wsum * 100);
  const band: Record<string, [number, number]> = { g: [70, 100], y: [40, 69], r: [0, 39] };
  const [lo, hi] = band[light];
  score = Math.max(lo, Math.min(hi, score));
  return { score, parts };
}

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

// ---------- Erholungszeit (eigene, offengelegte Schätzung) ----------
// Garmins Erholungszeit und Trainingsbereitschaft gibt es über die Personal API nicht. Deshalb je Einheit aus
// Garmins Trainingseffekt und der Trainingslast geschätzt:
//   aerober Trainingseffekt → Grundzeit: 1 → 0 h, 2 → 8 h, 3 → 18 h, 4 → 30 h, 5 → 54 h (dazwischen linear)
//   anaerober Trainingseffekt über 2 → je Punkt 8 h dazu (Intervalle, Sprints)
//   Last im Verhältnis zu deiner üblichen Einheit (Median der letzten 28 Tage): Faktor √(Last/üblich), 0,8 bis 1,3
//   höchstens 72 h. Es zählt, was davon jetzt noch offen ist (Ortszeit; ohne Uhrzeit 7:00 Uhr am Morgen der Nacht). Gute Nacht (HRV im oberen Teil
//   des Normalbereichs und Schlafscore ab 80) verkürzt den Rest um 15 %, eine schlechte (HRV unter dem Bereich oder
//   Schlafscore unter 60) verlängert ihn um 15 %. Mehrere Einheiten: die längste zählt voll, die übrigen zu 30 %.
//   Gelb ab 12 h offen, rot ab 48 h. Gelb heißt höchstens „Moderat trainieren“, rot „Erholung hat Vorrang“.
export interface AmpelAct { id?: string; date: string; start?: string | null; min?: number | null; te?: number | null; teAn?: number | null; load?: number | null; name?: string | null }
const TE_HOURS: Array<[number, number]> = [[1, 0], [2, 8], [3, 18], [4, 30], [5, 54]];
export const REC_YELLOW = 12, REC_RED = 48, REC_MAX = 72;

/** Geschätzte Erholungszeit einer Einheit in Stunden */
export function recoveryHours(a: AmpelAct, typicalLoad: number | null): number {
  const te = Math.max(0, Math.min(5, a.te || 0));
  let h = 0;
  for (let i = 1; i < TE_HOURS.length; i++) {
    const [x0, y0] = TE_HOURS[i - 1], [x1, y1] = TE_HOURS[i];
    if (te <= x1) { h = te <= x0 ? (i === 1 ? 0 : y0) : y0 + ((te - x0) / (x1 - x0)) * (y1 - y0); break; }
    h = y1;
  }
  h += Math.max(0, (a.teAn || 0) - 2) * 8;
  if (typicalLoad && a.load) h *= Math.max(0.8, Math.min(1.3, Math.sqrt(a.load / typicalLoad)));
  return Math.min(REC_MAX, h);
}

/** Stunden zwischen dem Ende der Einheit und dem Bezugszeitpunkt `ref` (Ortszeit als „UTC“-Millisekunden) */
function hoursSince(a: AmpelAct, ref: number): number {
  const [hh, mm] = (a.start || "12:00").split(":").map(Number);
  const end = Date.parse(a.date + "T00:00:00Z") + ((hh || 0) * 60 + (mm || 0) + (a.min || 0)) * 60000;
  return (ref - end) / 3600000;
}

/**
 * Noch offene Erholung: Stunden und die Einheit, die am meisten beiträgt. Bezug ist `at` (Ortszeit „JJJJ-MM-TTTHH:MM“,
 * normalerweise jetzt), ohne `at` 7:00 Uhr am Morgen von `day`. Fix nach Eddies Hinweis: vorher immer 7 Uhr der letzten
 * Nacht mit Daten, nachts stand dort dann ein Wert vom Vortag.
 */
export function openRecovery(acts: AmpelAct[], day: string, night: number = 1, at?: string): { hours: number; from: AmpelAct | null } {
  const ref = at ? Date.parse(at + ":00Z") : Date.parse(day + "T07:00:00Z");
  const refDay = at ? at.slice(0, 10) : day;
  const loads = acts.filter((a) => a.load && a.date < refDay && a.date >= addDays(refDay, -28)).map((a) => a.load as number);
  const typical = median(loads);
  const rest: Array<{ h: number; a: AmpelAct }> = [];
  for (const a of acts) {
    if (a.date > refDay || a.date < addDays(refDay, -4)) continue;
    const since = hoursSince(a, ref);
    if (since < 0) continue; // läuft noch bzw. liegt nach dem Bezugszeitpunkt
    const left = recoveryHours(a, typical) - since;
    if (left > 0) rest.push({ h: left, a });
  }
  if (!rest.length) return { hours: 0, from: null };
  rest.sort((x, y) => y.h - x.h);
  const total = rest[0].h + 0.3 * rest.slice(1).reduce((t, r) => t + r.h, 0);
  return { hours: Math.min(REC_MAX, total * night), from: rest[0].a };
}

/** Akut/chronisch am Tag `day`: Ø Trainingslast der letzten 7 bzw. 28 Tage (Tage ohne Training zählen als 0) */
export function loadRatio(loadByDay: Map<string, number>, day: string): number | null {
  const v: number[] = [];
  for (let i = 27; i >= 0; i--) v.push(loadByDay.get(addDays(day, -i)) || 0);
  const chronic = mean(v), acute = mean(v.slice(-7));
  return chronic ? acute! / chronic : null;
}

// ---------- Eigener HRV-Normalbereich (#119) ----------
// Für Quellen ohne eigenen Bereich (WHOOP): Schnitt ± eine Standardabweichung der Nächte der letzten 60 Tage aus
// derselben Quelle, mindestens 14 Nächte. Wochenschnitt = Schnitt der letzten 7 Tage (mindestens 3 Nächte).
export const BASE_DAYS = 60, BASE_MIN = 14;
export function hrvBaseline(days: Day[], day: string, src?: unknown): { lo: number; hi: number; wk: number | null; n: number } | null {
  const same = (x: Day) => x.hrv != null && (src == null || x.hrvSrc == null || x.hrvSrc === src);
  const base = days.filter((x) => x.d < day && x.d >= addDays(day, -BASE_DAYS) && same(x)).map((x) => x.hrv as number);
  if (base.length < BASE_MIN) return null;
  const m = mean(base)!, sd = Math.sqrt(base.reduce((t, v) => t + (v - m) ** 2, 0) / (base.length - 1));
  const wkV = days.filter((x) => x.d <= day && x.d > addDays(day, -7) && same(x)).map((x) => x.hrv as number);
  return { lo: Math.round(m - sd), hi: Math.round(m + sd), wk: wkV.length >= 3 ? Math.round(mean(wkV)!) : null, n: base.length };
}

/** WHOOP-Recovery wie in der WHOOP-App eingefärbt: grün ab 67 %, gelb 34–66 %, rot bis 33 % */
export const recLight = (v: number): Light => (v >= 67 ? "g" : v >= 34 ? "y" : "r");

/** Ampel für die letzte Nacht mit HRV oder Schlafscore. `days` aufsteigend sortiert. */
export function assess(days: Day[], loadByDay: Map<string, number>, acts?: AmpelAct[], now?: string): Ampel | null {
  const last = [...days].reverse().find((x) => x.hrv != null || x.score != null || x.rec != null);
  if (!last) return null;
  // Ohne Normalbereich der Quelle: eigener Bereich aus den letzten 60 Nächten (#119)
  let own = false;
  let d: Day = last;
  if (last.hrv != null && last.hrvLo == null) {
    const b = hrvBaseline(days, last.d, last.hrvSrc);
    if (b) { d = { ...last, hrvLo: b.lo, hrvHi: b.hi, hrvWk: last.hrvWk ?? b.wk }; own = true; }
  }
  const rhrBase = median(days.filter((x) => x.d < d.d && x.d >= addDays(d.d, -30)).map((x) => x.rhr));
  const ratio = loadRatio(loadByDay, d.d);
  const items: AmpelItem[] = [];
  let recH: number | null = null;
  if (d.hrv != null && d.hrvLo != null) {
    // Wie Garmins HRV-Status: bewertet wird der 7-Tage-Schnitt gegen den Normalbereich (im Bereich grün, darunter gelb,
    // mehr als 10 % darunter rot). Eine einzelne niedrige Nacht macht höchstens gelb; rot erst, wenn auch der
    // Wochenschnitt unter dem Bereich liegt (Eddies Fall: Nacht 65 ms nach Wettkampf, Woche 74 ms im Bereich).
    const band = (v: number): Light => (v < d.hrvLo * 0.9 ? "r" : v < d.hrvLo ? "y" : "g");
    const night = band(d.hrv), wk = d.hrvWk != null ? band(d.hrvWk) : null;
    const st: Light = wk == null ? night : night === "g" ? wk : wk === "g" ? "y" : night === "r" ? "r" : wk;
    items.push({ key: "hrv", st, name: "HRV", val: d.hrv + " ms" + (d.hrvWk != null ? " · Woche " + d.hrvWk : ""),
      why: `Letzte Nacht ${d.hrv} ms${d.hrvWk != null ? `, Schnitt der letzten 7 Tage ${d.hrvWk} ms` : ""}, ${own ? "dein eigener Normalbereich" : "Normalbereich"} ${d.hrvLo}–${d.hrvHi} ms${own ? ` (Schnitt ± Streuung deiner Nächte der letzten ${BASE_DAYS} Tage, gleiche Quelle)` : ""}. Bewertet wie Garmins HRV-Status über den Wochenschnitt: im Bereich grün, darunter gelb, mehr als 10 % darunter rot. Eine einzelne niedrige Nacht macht höchstens gelb.` });
  } else if (d.hrv != null) {
    items.push({ key: "hrv", st: "", name: "HRV", val: d.hrv + " ms", why: `Noch zu wenig Nächte für einen eigenen Normalbereich (mindestens ${BASE_MIN} in den letzten ${BASE_DAYS} Tagen).` });
  } else items.push({ key: "hrv", st: "", name: "HRV letzte Nacht", val: "fehlt", why: "Für diese Nacht liegt kein HRV-Wert vor." });
  // WHOOP-Recovery (#119): WHOOPs eigene Bewertung, eingefärbt wie in der WHOOP-App
  if (d.rec != null) items.push({ key: "rec", st: recLight(d.rec), name: "WHOOP-Recovery", val: d.rec + " %", why: "WHOOPs eigener Erholungswert. Grün ab 67 %, gelb 34–66 %, rot bis 33 % (wie in der WHOOP-App)." });
  if (d.rhr != null && rhrBase != null) {
    const diff = d.rhr - rhrBase;
    items.push({ key: "rhr", st: diff >= 5 ? "r" : diff >= 2 ? "y" : "g", name: "Ruhepuls", val: d.rhr + " bpm", why: `Dein Median der letzten 30 Tage: ${DE(rhrBase)} bpm. Gelb ab +2, rot ab +5.` });
  } else items.push({ key: "rhr", st: "", name: "Ruhepuls", val: "fehlt", why: "Kein Ruhepuls für diesen Tag." });
  // Schlaf: Schlafscore und Schlafdauer, der schlechtere zählt (sehr kurze Nacht = rot, auch bei gutem Score)
  if (d.score != null || d.slp != null) {
    const byScore: Light = d.score == null ? "" : d.score < 60 ? "r" : d.score < 80 ? "y" : "g";
    const byLen: Light = d.slp == null ? "" : d.slp < 5 ? "r" : d.slp < 6.5 ? "y" : "g";
    const st: Light = byScore === "r" || byLen === "r" ? "r" : byScore === "y" || byLen === "y" ? "y" : byScore || byLen;
    items.push({ key: "score", st, name: "Schlaf", val: [d.score != null ? "Score " + d.score : "", d.slp != null ? hm(d.slp) + " h" : ""].filter(Boolean).join(" · "),
      why: "Schlafscore gelb unter 80, rot unter 60. Schlafdauer gelb unter 6:30 h, rot unter 5 h. Der schlechtere Wert zählt." });
  } else items.push({ key: "score", st: "", name: "Schlaf", val: "fehlt", why: "Kein Schlaf erfasst." });
  if (ratio != null) items.push({ key: "load", st: ratio > 1.5 ? "r" : ratio > 1.3 ? "y" : "g", name: "Last akut zu chronisch", val: DE(ratio, 2), why: "Letzte 7 Tage gegen letzte 28 Tage. Gelb über 1,3, rot über 1,5." });
  else items.push({ key: "load", st: "", name: "Last akut zu chronisch", val: "fehlt", why: "Noch zu wenig Trainingshistorie." });
  // Erholungszeit nach harten Einheiten (#107), nur wenn die Einheiten übergeben werden
  // Ohne Garmin-Trainingseffekt (z. B. nur WHOOP-Einheiten) lässt sich die Erholungszeit nicht schätzen
  // (nur wenn es in den betrachteten letzten 4 Tagen Einheiten gibt, aber keine davon einen Trainingseffekt hat)
  const recent = (acts || []).filter((a) => a.date <= (now ? now.slice(0, 10) : d.d) && a.date >= addDays(d.d, -4));
  const withTe = acts && (!recent.length || recent.some((a) => a.te != null));
  if (acts && !withTe) items.push({ key: "recovery", st: "", name: "Erholung nach Training", val: "fehlt", why: "Die Schätzung braucht Garmins Trainingseffekt je Einheit. Deine letzten Einheiten haben keinen (z. B. nur von WHOOP oder Strava)." });
  if (acts && withTe) {
    const good = d.hrv != null && d.hrvLo != null && d.hrv >= d.hrvLo + (d.hrvHi - d.hrvLo) / 3 && (d.score ?? 0) >= 80;
    const bad = (d.hrv != null && d.hrvLo != null && d.hrv < d.hrvLo) || (d.score != null && d.score < 60);
    const rec = openRecovery(acts, d.d, good ? 0.85 : bad ? 1.15 : 1, now);
    const h = Math.round(rec.hours);
    recH = rec.hours;
    const src = rec.from ? `Nach „${rec.from.name || "Training"}“ am ${Number(rec.from.date.slice(8))}.${Number(rec.from.date.slice(5, 7))}. (Trainingseffekt ${DE(rec.from.te || 0, 1)}${rec.from.teAn ? " / " + DE(rec.from.teAn, 1) + " anaerob" : ""}). ` : "";
    items.push({ key: "recovery", st: h >= REC_RED ? "r" : h >= REC_YELLOW ? "y" : "g", name: "Erholung nach Training",
      val: h >= 1 ? `noch ca. ${h} h` : "abgeschlossen",
      why: src + "Eigene Schätzung aus Trainingseffekt und Last, Stand " + (now ? now.slice(11, 16) + " Uhr" : "7 Uhr") + ". Gelb ab 12 h offen, rot ab 48 h.",
      ...(rec.from && rec.from.id ? { actId: String(rec.from.id) } : {}) });
  }
  // Body Battery beim Aufwachen, nur wenn Garmin sie liefert
  if (d.bbWake != null) items.push({ key: "bb", st: d.bbWake < 30 ? "r" : d.bbWake < 50 ? "y" : "g", name: "Body Battery beim Aufwachen", val: String(d.bbWake), why: "Gelb unter 50, rot unter 30." });

  const reds = items.filter((i) => i.st === "r").length, yellows = items.filter((i) => i.st === "y").length;
  const known = items.filter((i) => i.st).length;
  let verdict: string, light: Light;
  if (known < 2) { verdict = "Zu wenig Daten für eine Einschätzung"; light = ""; }
  else if (reds) { verdict = "Erholung hat Vorrang"; light = "r"; }
  // Offene Erholung zählt mehr als ein einzelner gelber Wert: dann höchstens moderat (#107)
  else if (yellows >= 2 || items.some((i) => i.key === "recovery" && i.st === "y")) { verdict = "Moderat trainieren"; light = "y"; }
  else if (yellows === 1) { verdict = "Training normal möglich"; light = "g"; }
  else { verdict = "Bereit für intensives Training"; light = "g"; }
  const r = readiness({ hrv: d.hrv, hrvWk: d.hrvWk, hrvLo: d.hrvLo, rec: d.rec, score: d.score, slp: d.slp, recH, ratio, rhr: d.rhr, rhrBase, bb: d.bbWake }, light);
  return { day: d.d, light, verdict, items, score: r.score, parts: r.parts };
}

/** Text der Morgen-Meldung, z. B. „🟢 Training normal möglich“ / „HRV 62 ms · Ruhepuls 47 · Schlaf 7:12 h (Score 81) · Last 1,1“ */
export function pushText(a: Ampel, day: Day | undefined): { title: string; body: string } {
  const dot = a.light === "r" ? "🔴" : a.light === "y" ? "🟡" : a.light === "g" ? "🟢" : "⚪️";
  const parts: string[] = [];
  if (day?.rec != null) parts.push(`Recovery ${day.rec} %`);
  if (day?.hrv != null) parts.push(`HRV ${day.hrv} ms`);
  if (day?.rhr != null) parts.push(`Ruhepuls ${day.rhr}`);
  if (day?.slp != null) parts.push(`Schlaf ${hm(day.slp)} h` + (day.score != null ? ` (Score ${day.score})` : ""));
  const load = a.items.find((i) => i.key === "load");
  if (load && load.st) parts.push(`Last ${load.val}`);
  const rec = a.items.find((i) => i.key === "recovery");
  if (rec && (rec.st === "y" || rec.st === "r")) parts.push(`Erholung ${rec.val}`);
  return { title: `${dot} ${a.score != null ? "Bereitschaft " + a.score + " · " : ""}${a.verdict}`, body: parts.join(" · ") || "Tippe für Details." };
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

// ---------- Automatisch nach dem Aufwachen ----------
/** Vorher nie senden (die Nacht läuft noch), auch wenn schon Werte für heute da sind */
export const AUTO_START = "03:00";
/** Schlaf ist da, die HRV noch nicht: so lange auf sie warten, dann ohne sie senden */
export const HRV_WAIT_MIN = 45;
/** Stand der letzten Nacht in der bevorzugten Quelle (Garmin, WHOOP …) */
export interface NightState { sleep: boolean; hrv: boolean; hrvUsual: boolean; sleepSeenMin: number | null }
/**
 * Morgen-Push im Modus „automatisch“: senden, sobald der Schlaf der letzten Nacht da ist (und die HRV, wenn die Person
 * sonst eine hat). Kommt bis `latest` nichts, mit dem letzten Stand senden. Einmal am Tag, nicht vor AUTO_START.
 */
export function decideAuto(cfg: { on: boolean; latest: string; lastSent?: string }, today: string, now: string, night: NightState): "send" | "send-stale" | "wait" | "skip" {
  if (!cfg.on || cfg.lastSent === today || toMin(now) < toMin(AUTO_START)) return "skip";
  if (night.sleep && (night.hrv || !night.hrvUsual)) return "send";
  if (night.sleep && night.sleepSeenMin != null && night.sleepSeenMin >= HRV_WAIT_MIN) return "send";
  if (toMin(now) >= toMin(cfg.latest)) return night.sleep ? "send" : "send-stale";
  return "wait";
}
