// Rad-Wetter-Planer (#153): Wann kann ich fahren, was ziehe ich an? Reine Funktionen ohne Importe (die Tests laden die
// Datei direkt, siehe CLAUDE.md), getestet in test/radwetter.test.ts. Abruf, Speichern und Mitteilungen: radwetter-api.ts.
//
// Ablauf: Vorhersage von Open-Meteo einlesen (parseForecast) → je Stunde, wie nass die Straße ist (roadFilm), und die
// Bewertung nach den eigenen Kriterien (rateHours) → gute Fenster (findWindows) → Wind-Rat und passende Lieblingsrunde
// (windAdvice, rankRoutes) → Kleidung für eine Fahrt (wearFor: Grundstufe, Zusatzteile mit eigenen Regeln, Fahrtwind,
// gelernt aus Rückmeldungen) → Mitteilungen (pushPlan, pushMsg) → Dranbleiben (game: genutzte Fenster, Serie, Abzeichen).
// Jede Regel steht als Text daneben (…Text-Funktionen), damit die Oberfläche zeigen kann, was gegriffen hat.

// ---------- Kleine Helfer ----------
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const isNum = (x: unknown): x is number => typeof x === "number" && isFinite(x);
/** Zahl auf Deutsch: Komma, echtes Minus */
export const fmt = (x: number, d = 0) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",").replace(/^-(?=.*[1-9])/, "−").replace(/^-/, "");
/** Ort auf 0,01° runden (etwa 1 km): nur so gehen Orte an Open-Meteo */
export const fine = (x: number) => Math.round(x * 100) / 100;
/** „HH:MM“ → Stunden als Zahl (7:30 → 7,5) */
export const hours = (hm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ""); return m ? Number(m[1]) + Number(m[2]) / 60 : NaN; };
const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// ---------- Vorhersage ----------
/**
 * Eine Stunde [e, e + 1 h) in Ortszeit. Open-Meteo liefert Niederschlag, Regenrisiko, Wettercode, Sonnenschein und Böen
 * für die Stunde *davor*; beim Einlesen werden sie deshalb um eine Stunde verschoben. Momentwerte (Temperatur, Wind …)
 * sind der Mittelwert aus Anfang und Ende der Stunde.
 */
export interface Hour {
  e: number; d: string; h: number; wd: number; // Beginn (Unix-Sekunden), Ortsdatum, Ortsstunde, Wochentag (0 = So)
  t: number; ta: number; rh: number;            // Temperatur, gefühlt (Open-Meteo), Luftfeuchte
  p: number; pp: number; c: number; cc: number; // Niederschlag mm, Regenrisiko %, WMO-Code, Bewölkung %
  ws: number; wg: number; wdir: number;         // Wind, Böen km/h, Richtung ° (woher)
  sun: number; light: number;                   // Sonnenminuten, Minuten Tageslicht in dieser Stunde
}
export interface Fc { tz: string; hours: Hour[] }

const HOURLY = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "precipitation_probability",
  "weather_code", "cloud_cover", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "is_day", "sunshine_duration"];

/** Abfrage für mehrere Orte auf einmal (eine Anfrage, Workers Free erlaubt nur 50 je Aufruf), jeder auf 0,01° gerundet */
export function fcUrl(points: Array<[number, number]>): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => fine(p[0]).toFixed(2)).join(","),
    longitude: points.map((p) => fine(p[1]).toFixed(2)).join(","),
    hourly: HOURLY.join(","), daily: "sunrise,sunset",
    // Gestern dazu: Wie nass ist die Straße? Vier Tage voraus: 48 h plus die Dauer einer Fahrt am Ende
    past_days: "1", forecast_days: "4", timezone: "auto", timeformat: "unixtime", wind_speed_unit: "kmh",
  });
  return "https://api.open-meteo.com/v1/forecast?" + q.toString();
}

const FMT = new Map<string, Intl.DateTimeFormat>();
/** Abstand der Ortszeit zu UTC in Sekunden (mit Sommerzeit) */
export function tzOffset(tz: string, e: number): number {
  let f = FMT.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }); FMT.set(tz, f); }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(e * 1000))) if (x.type !== "literal") p[x.type] = Number(x.value);
  // Ortszeit ohne Sekunden, deshalb auch e auf volle Minuten
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000 - Math.floor(e / 60) * 60) / 60) * 60;
}
/** Abstände für viele Zeitpunkte: meist überall gleich, sonst den Wechsel der Sommerzeit per Halbierung suchen */
function offsets(tz: string, es: number[], fallback: number): number[] {
  const out = new Array<number>(es.length).fill(fallback);
  if (!es.length) return out;
  try { tzOffset(tz, es[0]); } catch { return out; }
  const fill = (a: number, b: number, oa: number, ob: number) => {
    if (oa === ob) { for (let i = a; i <= b; i++) out[i] = oa; return; }
    if (b - a <= 1) { out[a] = oa; out[b] = ob; return; }
    const m = (a + b) >> 1, om = tzOffset(tz, es[m]);
    fill(a, m, oa, om); fill(m, b, om, ob);
  };
  fill(0, es.length - 1, tzOffset(tz, es[0]), tzOffset(tz, es[es.length - 1]));
  return out;
}
/** Ortsdatum, -stunde und Wochentag aus Unix-Sekunden und Abstand */
export function localOf(e: number, off: number): { d: string; h: number; wd: number } {
  const t = new Date((e + off) * 1000);
  return { d: t.toISOString().slice(0, 10), h: t.getUTCHours(), wd: t.getUTCDay() };
}

/** Eine Antwort von Open-Meteo (ein Ort) in Stunden umwandeln; null bei unbrauchbarer Antwort */
export function parseForecast(j: unknown): Fc | null {
  const o = j as any, h = o?.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length < 3) return null;
  const tz = typeof o.timezone === "string" && o.timezone ? o.timezone : "UTC";
  const es: number[] = h.time.map(Number);
  if (!es.every(isNum)) return null;
  const offs = offsets(tz, es, isNum(o.utc_offset_seconds) ? o.utc_offset_seconds : 0);
  const v = (k: string, i: number, d = 0) => { const a = h[k]; const x = Array.isArray(a) ? a[i] : null; return isNum(x) ? x : d; };
  const mid = (k: string, i: number) => (v(k, i) + v(k, i + 1, v(k, i))) / 2;
  const rise: unknown[] = Array.isArray(o.daily?.sunrise) ? o.daily.sunrise : [], set: unknown[] = Array.isArray(o.daily?.sunset) ? o.daily.sunset : [];
  // Minuten Tageslicht je Stunde aus Sonnenauf- und -untergang; ohne die Tageswerte aus is_day
  const light = (e: number, i: number) => {
    if (!rise.length) return v("is_day", i) ? 60 : 0;
    let s = 0;
    for (let k = 0; k < rise.length; k++) { const a = rise[k], b = set[k]; if (isNum(a) && isNum(b)) s += Math.max(0, Math.min(e + 3600, b) - Math.max(e, a)); }
    return Math.round(Math.min(3600, s) / 60);
  };
  const hoursOut: Hour[] = [];
  for (let i = 0; i < es.length - 1; i++) {
    const e = es[i], loc = localOf(e, offs[i]);
    // Windrichtung als Vektor mitteln (350° und 10° ergeben 0°, nicht 180°)
    const a1 = v("wind_direction_10m", i) * Math.PI / 180, a2 = v("wind_direction_10m", i + 1, v("wind_direction_10m", i)) * Math.PI / 180;
    const wdir = Math.round(((Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2)) * 180 / Math.PI) + 360) % 360);
    hoursOut.push({
      e, ...loc,
      t: r1(mid("temperature_2m", i)), ta: r1(mid("apparent_temperature", i)), rh: Math.round(mid("relative_humidity_2m", i)),
      p: r1(v("precipitation", i + 1)), pp: Math.round(v("precipitation_probability", i + 1)), c: Math.round(v("weather_code", i + 1)),
      cc: Math.round(mid("cloud_cover", i)), ws: Math.round(mid("wind_speed_10m", i)), wg: Math.round(v("wind_gusts_10m", i + 1, v("wind_speed_10m", i))),
      wdir, sun: Math.round(v("sunshine_duration", i + 1) / 60), light: light(e, i),
    });
  }
  return { tz, hours: hoursOut };
}

/** Stunden platzsparend speichern (Spalten statt Objekte) und wieder auspacken */
const KEYS = ["e", "h", "wd", "t", "ta", "rh", "p", "pp", "c", "cc", "ws", "wg", "wdir", "sun", "light"] as const;
export function packHours(hs: Hour[]): Record<string, unknown> {
  const o: Record<string, unknown> = { d: hs.map((x) => x.d) };
  for (const k of KEYS) o[k] = hs.map((x) => x[k]);
  return o;
}
export function unpackHours(o: any): Hour[] {
  if (!o || !Array.isArray(o.e)) return [];
  return o.e.map((_: unknown, i: number) => {
    const x: any = { d: o.d[i] };
    for (const k of KEYS) x[k] = Array.isArray(o[k]) && isNum(o[k][i]) ? o[k][i] : 0;
    return x as Hour;
  });
}

// ---------- Straße nass oder trocken ----------
// Gedachter Wasserfilm auf der Straße: Regen füllt ihn auf (höchstens FILM_MAX mm, mehr läuft ab), jede trockene Stunde
// trocknet ihn ab. Nach kräftigem Regen dauert das `wait` Stunden; Sonne, Wärme und Wind beschleunigen, Nacht, Kälte und
// feuchte Luft bremsen. Der Film vor den Daten (vorgestern) gilt als trocken.
export const FILM_MAX = 1.2;
export const DRY = { sun: 1.5, warm: 1.3, wind: 1.2, night: 0.6, humid: 0.7, cold: 0.7 };
export function dryFactor(h: Hour): number {
  let f = 1;
  if (h.sun >= 30) f *= DRY.sun;
  if (h.t >= 18) f *= DRY.warm;
  if (h.ws >= 15) f *= DRY.wind;
  if (h.light < 30) f *= DRY.night;
  if (h.rh >= 90) f *= DRY.humid;
  if (h.t < 5) f *= DRY.cold;
  return f;
}
/** Wasserfilm (mm) zu Beginn jeder Stunde */
export function roadFilm(hs: Hour[], wait = 3): number[] {
  const out: number[] = [];
  const base = FILM_MAX / clamp(wait, 1, 8);
  let w = 0;
  for (const h of hs) {
    out.push(r2(w));
    w = Math.min(FILM_MAX, w + Math.max(0, h.p));
    if (h.p < 0.1) w = Math.max(0, w - base * dryFactor(h));
  }
  return out;
}
export type Road = "trocken" | "feucht" | "nass";
export const roadState = (film: number, p: number): Road => (p >= 0.1 || film > 0.3 ? "nass" : film > 0.05 ? "feucht" : "trocken");
/** Die Regel als Text für die Oberfläche */
export function dryRuleText(wait: number): string {
  return `Die Straße gilt als trocken, wenn ein gedachter Wasserfilm abgetrocknet ist. Regen füllt ihn auf (höchstens ${fmt(FILM_MAX, 1)} mm, mehr läuft ab), `
    + `jede trockene Stunde trocknet ihn ab: nach kräftigem Regen in ${fmt(wait)} Stunden, mit Sonne, ab 18 °C oder Wind ab 15 km/h schneller, `
    + `nachts, unter 5 °C oder bei Luftfeuchte ab 90 % langsamer.`;
}

// ---------- Kriterien und Bewertung je Stunde ----------
export interface Crit {
  prob: number; mm: number;            // Regenrisiko höchstens %, Niederschlag höchstens mm je Stunde
  dry: boolean; wait: number;          // Straße muss trocken sein; Stunden bis trocken nach kräftigem Regen
  wind: number; gust: number;          // Wind und Böen höchstens km/h
  tMin: number | null; tMax: number | null; // Temperatur von–bis (null = egal)
  minH: number; light: boolean;        // Mindestdauer in Stunden, nur bei Tageslicht
  days: boolean[];                     // erlaubte Wochentage, Index 0 = Sonntag
  wk: [number, number]; we: [number, number]; // Uhrzeiten Mo–Fr und Sa/So, [von, bis) in Stunden
}
export const DEFAULT_CRIT: Crit = {
  prob: 30, mm: 0, dry: true, wait: 3, wind: 25, gust: 45, tMin: 4, tMax: 30, minH: 2, light: true,
  days: [true, true, true, true, true, true, true], wk: [6, 21], we: [7, 20],
};
const numIn = (x: unknown, a: number, b: number, d: number) => (isNum(Number(x)) && x !== null && x !== "" ? clamp(Number(x), a, b) : d);
/** Eingaben aus der Oberfläche prüfen und begrenzen */
export function cleanCrit(x: any): Crit {
  const c: Crit = { ...DEFAULT_CRIT, days: [...DEFAULT_CRIT.days], wk: [...DEFAULT_CRIT.wk], we: [...DEFAULT_CRIT.we] };
  if (!x || typeof x !== "object") return c;
  const range = (v: unknown, d: [number, number]): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2) return [...d] as [number, number];
    const a = Math.round(numIn(v[0], 0, 23, d[0])), b = Math.round(numIn(v[1], 1, 24, d[1]));
    return a < b ? [a, b] : [...d] as [number, number];
  };
  c.prob = Math.round(numIn(x.prob, 0, 100, DEFAULT_CRIT.prob));
  c.mm = r1(numIn(x.mm, 0, 5, DEFAULT_CRIT.mm));
  c.dry = x.dry !== false;
  c.wait = Math.round(numIn(x.wait, 1, 8, DEFAULT_CRIT.wait));
  c.wind = Math.round(numIn(x.wind, 5, 80, DEFAULT_CRIT.wind));
  c.gust = Math.round(numIn(x.gust, 10, 120, DEFAULT_CRIT.gust));
  c.tMin = x.tMin === null || x.tMin === "" ? null : Math.round(numIn(x.tMin, -20, 30, DEFAULT_CRIT.tMin ?? 4));
  c.tMax = x.tMax === null || x.tMax === "" ? null : Math.round(numIn(x.tMax, 0, 45, DEFAULT_CRIT.tMax ?? 30));
  if (c.tMin != null && c.tMax != null && c.tMin >= c.tMax) c.tMax = c.tMin + 1;
  c.minH = Math.round(numIn(x.minH, 1, 8, DEFAULT_CRIT.minH));
  c.light = x.light !== false;
  c.days = Array.isArray(x.days) && x.days.length === 7 ? x.days.map((d: unknown) => d !== false) : [...DEFAULT_CRIT.days];
  if (!c.days.some(Boolean)) c.days = [...DEFAULT_CRIT.days];
  c.wk = range(x.wk, DEFAULT_CRIT.wk); c.we = range(x.we, DEFAULT_CRIT.we);
  return c;
}

export interface Rated {
  st: "good" | "meh" | "bad";  // gut, knapp (nur weiche Kriterien knapp verfehlt), schlecht
  off: "" | "zeit" | "dunkel"; // nicht in deinen Zeiten bzw. dunkel (zählt nicht für Fenster)
  why: string[]; score: number; film: number; road: Road;
}
/** Liegt die ganze Stunde in den eigenen Zeiten? */
export function inSlot(h: Hour, c: Crit): boolean {
  if (!c.days[h.wd]) return false;
  const [a, b] = h.wd === 0 || h.wd === 6 ? c.we : c.wk;
  return h.h >= a && h.h + 1 <= b;
}
/** Wertung 0–100 für die Reihenfolge der Fenster: trocken, wenig Wind, angenehm warm, Sonne */
export function hourScore(h: Hour, film: number): number {
  let s = 100;
  s -= Math.min(40, h.pp * 0.5);
  s -= h.p * 40;
  s -= Math.max(0, h.ws - 10) * 1.2;
  s -= Math.max(0, h.wg - 25) * 0.6;
  s -= Math.max(0, 12 - h.t) * 1.5 + Math.max(0, h.t - 26) * 2;
  s += Math.min(10, h.sun / 6);
  const road = roadState(film, h.p);
  if (road === "nass") s -= 15; else if (road === "feucht") s -= 6;
  return Math.round(clamp(s, 0, 100));
}
export function rateHour(h: Hour, film: number, c: Crit): Rated {
  const why: string[] = [];
  let hard = false, soft = false;
  const miss = (text: string, near: boolean) => { why.push(text); if (near) soft = true; else hard = true; };
  const mmMax = Math.max(0.05, c.mm);
  const road = roadState(film, h.p);
  if (h.p > mmMax) miss("Regen " + fmt(h.p, 1) + " mm", h.p <= mmMax + 0.2);
  if (h.pp > c.prob) miss("Regenrisiko " + h.pp + " %", h.pp <= c.prob + 15);
  if (c.dry && h.p <= mmMax && road !== "trocken") miss(road === "nass" ? "Straße nass" : "Straße feucht", road === "feucht");
  if (h.ws > c.wind) miss("Wind " + h.ws + " km/h", h.ws <= c.wind + 5);
  if (h.wg > c.gust) miss("Böen " + h.wg + " km/h", h.wg <= c.gust + 10);
  if (c.tMin != null && h.t < c.tMin) miss("kalt, " + fmt(h.t) + " °C", h.t >= c.tMin - 2);
  if (c.tMax != null && h.t > c.tMax) miss("heiß, " + fmt(h.t) + " °C", h.t <= c.tMax + 2);
  const off = !inSlot(h, c) ? "zeit" : c.light && h.light < 30 ? "dunkel" : "";
  return { st: hard ? "bad" : soft ? "meh" : "good", off, why, score: hourScore(h, film), film, road };
}
export function rateHours(hs: Hour[], c: Crit): Rated[] {
  const film = roadFilm(hs, c.wait);
  return hs.map((h, i) => rateHour(h, film[i], c));
}

// ---------- Gute Fenster ----------
export interface Win {
  i: number; n: number; s: number; e: number;        // erster Stunden-Index, Anzahl Stunden, Beginn/Ende (Unix-Sekunden)
  d: string; wd: number; h0: number; h1: number;     // Ortsdatum, Wochentag, Stunde Beginn und Ende (Ende 24 = Mitternacht)
  score: number; t: [number, number]; ta: [number, number];
  ws: number; wg: number; wdir: number; pp: number; sun: number;
}
/** Zusammenhängende gute Stunden in den eigenen Zeiten, mindestens `minH` Stunden lang */
export function findWindows(hs: Hour[], rated: Rated[], c: Crit): Win[] {
  const out: Win[] = [];
  let i = 0;
  while (i < hs.length) {
    if (rated[i].st !== "good" || rated[i].off) { i++; continue; }
    let j = i;
    while (j + 1 < hs.length && rated[j + 1].st === "good" && !rated[j + 1].off && hs[j + 1].e - hs[j].e === 3600) j++;
    const n = j - i + 1;
    if (n >= c.minH) {
      const part = hs.slice(i, j + 1), wm = windMean(part);
      out.push({
        i, n, s: hs[i].e, e: hs[j].e + 3600, d: hs[i].d, wd: hs[i].wd, h0: hs[i].h, h1: hs[j].h + 1,
        score: Math.round(rated.slice(i, j + 1).reduce((s, r) => s + r.score, 0) / n),
        t: [Math.min(...part.map((x) => x.t)), Math.max(...part.map((x) => x.t))],
        ta: [Math.min(...part.map((x) => x.ta)), Math.max(...part.map((x) => x.ta))],
        ws: wm.ws, wg: Math.max(...part.map((x) => x.wg)), wdir: wm.dir, pp: Math.max(...part.map((x) => x.pp)),
        sun: part.reduce((s, x) => s + x.sun, 0),
      });
    }
    i = j + 1;
  }
  return out;
}
/** Nächstes Fenster, das noch nicht vorbei ist (läuft es gerade, dieses) */
export const nextWindow = (wins: Win[], now: number) => wins.find((w) => w.e > now) || null;
/** Bestes Fenster der nächsten `horizon` Stunden: Wertung, längere leicht bevorzugt */
export function bestWindow(wins: Win[], now: number, horizon = 48): Win | null {
  let best: Win | null = null, bestRank = -1;
  for (const w of wins) {
    if (w.e <= now || w.s >= now + horizon * 3600) continue;
    const rank = w.score + Math.min(10, (w.n - 1) * 2);
    if (rank > bestRank) { best = w; bestRank = rank; }
  }
  return best;
}
export const quality = (score: number) => (score >= 80 ? "sehr gut" : score >= 60 ? "gut" : "okay");
/** „heute“, „morgen“ oder der Wochentag */
export function dayWord(d: string, today: string): string {
  if (d === today) return "heute";
  if (d === addDays(today, 1)) return "morgen";
  return DAY_NAMES[new Date(d + "T12:00:00Z").getUTCDay()];
}
export const winTime = (w: { h0: number; h1: number }) => `${w.h0}–${w.h1 % 24 === 0 && w.h1 ? 24 : w.h1} Uhr`;

// ---------- Wind ----------
export const COMPASS = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
export const COMPASS_SHORT = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const sector = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;
export const compass = (deg: number) => COMPASS[sector(deg)];
export const compassShort = (deg: number) => COMPASS_SHORT[sector(deg)];
/** Mittlerer Wind über mehrere Stunden: Richtung als Vektor (nach Stärke gewichtet), Stärke und Böen */
export function windMean(hs: Array<{ ws: number; wg: number; wdir: number }>): { dir: number; ws: number; wg: number } {
  if (!hs.length) return { dir: 0, ws: 0, wg: 0 };
  let x = 0, y = 0;
  for (const h of hs) { const a = h.wdir * Math.PI / 180; x += Math.sin(a) * Math.max(1, h.ws); y += Math.cos(a) * Math.max(1, h.ws); }
  return { dir: Math.round(((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360), ws: Math.round(hs.reduce((s, h) => s + h.ws, 0) / hs.length), wg: Math.max(...hs.map((h) => h.wg)) };
}
/** Richtung von a nach b in Grad (0 = Norden) */
export function bearing(a: [number, number], b: [number, number]): number {
  const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map((v) => v * Math.PI / 180);
  const y = Math.sin(lo2 - lo1) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return Math.round(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360);
}
export function distKm(a: [number, number], b: [number, number]): number {
  const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Lieblingsrunde aus einer Route: Länge, Mitte (dort wird das Wetter abgefragt, verrät weniger als der Start), Halbzeit-Punkt
 * und dessen Richtung vom Start. Beim Wind zählt nur, wo die Halbzeit liegt: Auf der ersten Hälfte summiert sich der
 * Gegenwind genau über die Strecke vom Start zur Halbzeit, egal in welcher Richtung man eine Runde fährt.
 * Dazu eine Skizze der Form (0–100, ohne Koordinaten) für die Oberfläche.
 */
export interface RouteInfo { km: number; c: [number, number]; half: [number, number]; bear: number; spread: number; sk: Array<[number, number]>; hi: number }
export function routeInfo(pts: Array<[number, number]>): RouteInfo | null {
  const p = pts.filter((x) => Array.isArray(x) && isNum(x[0]) && isNum(x[1]) && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180);
  if (p.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + distKm(p[i - 1], p[i]));
  const km = cum[cum.length - 1];
  if (km < 0.5) return null;
  let hiFull = cum.findIndex((c) => c >= km / 2);
  if (hiFull < 0) hiFull = p.length - 1;
  const half = p[hiFull];
  const la = p.map((x) => x[0]), lo = p.map((x) => x[1]);
  const c: [number, number] = [(Math.min(...la) + Math.max(...la)) / 2, (Math.min(...lo) + Math.max(...lo)) / 2];
  // Skizze: höchstens 64 Punkte, flächentreu genug (Länge mal cos(Breite)), mittig in 0–100
  const step = Math.max(1, Math.ceil(p.length / 64));
  const idx: number[] = [];
  for (let i = 0; i < p.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== p.length - 1) idx.push(p.length - 1);
  const k = Math.cos(c[0] * Math.PI / 180);
  const xs = idx.map((i) => (p[i][1] - c[1]) * k), ys = idx.map((i) => -(p[i][0] - c[0]));
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sk = xs.map((x, j) => [Math.round(50 + (x - cx) / span * 84), Math.round(50 + (ys[j] - cy) / span * 84)] as [number, number]);
  const hi = idx.reduce((best, i, j) => (Math.abs(i - hiFull) < Math.abs(idx[best] - hiFull) ? j : best), 0);
  return { km: r1(km), c: [fine(c[0]), fine(c[1])], half: [Math.round(half[0] * 1000) / 1000, Math.round(half[1] * 1000) / 1000], bear: bearing(p[0], half), spread: r1(distKm(p[0], half)), sk, hi };
}

export interface Advice { text: string; short: string; fit: number | null; kind: "ruhig" | "gut" | "seite" | "schlecht" | "kurz" | "frei" }
/**
 * Wind-Rat: „Fahr zuerst gegen den Wind raus“. Ohne Runde die Richtung, mit Runde, ob ihre Halbzeit gegen den Wind liegt
 * (fit = cos des Winkels: +1 gegen den Wind raus, −1 heimwärts Gegenwind).
 */
export function windAdvice(dir: number, ws: number, route?: { bear: number; spread: number; name?: string } | null): Advice {
  const from = compass(dir), short = compassShort(dir);
  if (ws < 10) return { text: `Kaum Wind (${ws} km/h): Die Richtung ist heute egal.`, short: "Kaum Wind, Richtung egal.", fit: null, kind: "ruhig" };
  if (!route) {
    return { text: `Wind aus ${from} (${ws} km/h): Fahr zuerst Richtung ${from}, gegen den Wind, dann mit Rückenwind zurück.`,
      short: `Erst Richtung ${short}, gegen den Wind.`, fit: null, kind: "frei" };
  }
  if (route.spread < 3) return { text: `Wind aus ${from} (${ws} km/h). Diese Runde bleibt nah am Start, der Wind gleicht sich aus.`, short: "Wind gleicht sich aus.", fit: 0, kind: "kurz" };
  const fit = Math.round(Math.cos((route.bear - dir) * Math.PI / 180) * 100) / 100;
  if (fit >= 0.5) return { text: `Passt: Die erste Hälfte führt Richtung ${compass(route.bear)}, gegen den Wind aus ${from} (${ws} km/h). Heimwärts schiebt er dich.`, short: "Erst gegen den Wind, heimwärts Rückenwind.", fit, kind: "gut" };
  if (fit <= -0.5) return { text: `Achtung: Die erste Hälfte führt Richtung ${compass(route.bear)}, mit dem Wind aus ${from} (${ws} km/h). Auf dem Heimweg hast du Gegenwind.`, short: "Heimwärts Gegenwind.", fit, kind: "schlecht" };
  return { text: `Wind aus ${from} (${ws} km/h) kommt bei dieser Runde vor allem von der Seite.`, short: "Vor allem Seitenwind.", fit, kind: "seite" };
}
/** Lieblingsrunden für ein Fenster ordnen: Wind (Halbzeit gegen den Wind) und ob die Runde in das Fenster passt */
export function rankRoutes<T extends { id: string; bear: number; spread: number; km: number }>(routes: T[], wind: { dir: number; ws: number }, hoursFree: number, speed: number) {
  const v = speed > 5 ? speed : 25;
  return routes.map((r) => {
    const adv = windAdvice(wind.dir, wind.ws, r);
    const need = r.km / v;
    const fits = need <= hoursFree + 0.01;
    const windPart = adv.fit == null ? 0 : adv.fit * Math.min(1, wind.ws / 20);
    return { ...r, adv, need: r1(need), fits, rank: r2(windPart + (fits ? 0.4 : -0.6)) };
  }).sort((a, b) => b.rank - a.rank);
}

// ---------- Kleidung ----------
export type Lvl = "kk" | "kl" | "lk" | "ll" | "wi";
export type Cover = "kurz" | "lang" | "winter";
/** Grundstufen von leicht nach warm: oben (Trikot) und unten (Hose) */
export const LEVELS: Array<{ id: Lvl; name: string; top: Cover; legs: Cover; desc: string }> = [
  { id: "kk", name: "kurz-kurz", top: "kurz", legs: "kurz", desc: "Trikot kurz, Hose kurz" },
  { id: "kl", name: "kurz-lang", top: "kurz", legs: "lang", desc: "Trikot kurz, Hose lang" },
  { id: "lk", name: "lang-kurz", top: "lang", legs: "kurz", desc: "Trikot lang, Hose kurz" },
  { id: "ll", name: "lang-lang", top: "lang", legs: "lang", desc: "Trikot lang, Hose lang" },
  { id: "wi", name: "Winter", top: "winter", legs: "winter", desc: "Thermojacke, Thermohose" },
];
const LV = Object.fromEntries(LEVELS.map((l) => [l.id, l])) as Record<Lvl, (typeof LEVELS)[number]>;
const COVER_RANK: Record<Cover, number> = { kurz: 0, lang: 1, winter: 2 };

/** Bedingungen einer Regel; alle angegebenen müssen zutreffen. Mehrere Regeln je Teil: eine reicht. */
export interface Clause {
  below?: number;      // gefühlt (kältester Moment der Fahrt) unter X °C
  from?: number;       // gefühlt (wärmster Moment) ab X °C
  wind?: number;       // Wind ab X km/h
  gust?: number;       // Böen ab X km/h
  rain?: number;       // Regenrisiko ab X % (Regen ab 0,3 mm zählt immer)
  wet?: boolean;       // Regen oder nasse Straße
  warmer?: number;     // wird während der Fahrt um mindestens X °C wärmer
  startBelow?: number; // zu Beginn gefühlt unter X °C
  dark?: boolean;      // ganz oder teils im Dunkeln
  swap?: "top" | "legs"; // abnehmbar statt dickerer Grundstufe (oben bzw. unten), siehe wearFor
}
/** Zusatzteil mit eigenen Regeln. part = Ebene der Figur (figur.js.txt), null = nur in der Liste */
export interface Item { id: string; name: string; part: string | null; on: boolean; rules: Clause[]; own?: boolean }
// Vorschläge in „gefühlt auf dem Rad“ (mit Fahrtwind, siehe rideChill): etwa 4–7 °C unter der Lufttemperatur.
export const DEFAULT_ITEMS: Item[] = [
  { id: "muetze", name: "Mütze oder Buff", part: "muetze", on: true, rules: [{ below: 1 }] },
  { id: "unterhemd", name: "Unterhemd", part: "unterhemd", on: true, rules: [{ below: 8 }] },
  { id: "armlinge", name: "Armlinge", part: "armlinge", on: true, rules: [{ swap: "top" }] },
  { id: "gilet", name: "Gilet", part: "gilet", on: true, rules: [{ wind: 20, below: 14 }, { warmer: 5, startBelow: 8 }] },
  { id: "windjacke", name: "Windjacke", part: "windjacke", on: true, rules: [{ below: 5, wind: 25 }, { gust: 45, below: 9 }] },
  { id: "regenjacke", name: "Regenjacke", part: "regenjacke", on: true, rules: [{ rain: 40 }] },
  { id: "handschuhKurz", name: "Handschuhe kurz", part: "handschuhKurz", on: true, rules: [{ from: 5 }] },
  { id: "handschuhLang", name: "Handschuhe lang", part: "handschuhLang", on: true, rules: [{ below: 5 }] },
  { id: "knielinge", name: "Knielinge", part: "knielinge", on: true, rules: [{ below: 10 }] },
  { id: "beinlinge", name: "Beinlinge", part: "beinlinge", on: true, rules: [{ swap: "legs" }] },
  { id: "ueberschuhe", name: "Überschuhe", part: "ueberschuhe", on: true, rules: [{ below: 0 }, { wet: true, below: 8 }] },
  { id: "licht", name: "Licht", part: null, on: true, rules: [{ dark: true }] },
];
export interface WearCfg {
  speed: number;                         // Tempo für den Fahrtwind in km/h (0 = aus)
  lv: Record<"kk" | "kl" | "lk" | "ll", number | null>; // Grundstufe ab gefühlt °C (null = Stufe nicht genutzt)
  swing: number;                         // abnehmbare Teile statt dickerer Stufe ab so viel °C Unterschied
  wetCold: number; wetProb: number;      // nasse Stunden so viel °C kälter rechnen; Regen ab dieser Wahrscheinlichkeit
  dur: number;                           // übliche Dauer in Minuten
  items: Item[];
}
export const DEFAULT_WEAR: WearCfg = { speed: 27, lv: { kk: 14, kl: null, lk: 8, ll: -1 }, swing: 4, wetCold: 3, wetProb: 50, dur: 120, items: DEFAULT_ITEMS };

/**
 * Fahrtwind: Auf dem Rad fühlt es sich kälter an als im Stehen. Je 10 km/h Tempo 1 °C kühler, bei Kälte stärker
 * (bei 15 °C und wärmer 1 °C, bei 0 °C und kälter 2 °C je 10 km/h, dazwischen gleitend).
 */
export const rideChill = (speed: number, t: number) => (speed > 0 ? r1((speed / 10) * clamp(2 - t / 15, 1, 2)) : 0);
export const chillText = (speed: number) => (speed > 0
  ? `Fahrtwind bei ${fmt(speed)} km/h: je 10 km/h 1 °C kühler, bei Kälte bis doppelt so viel (ab 15 °C 1 °C, bei 0 °C 2 °C).`
  : "Fahrtwind ist ausgeschaltet.");
/** Gefühlt auf dem Rad: Open-Meteos gefühlte Temperatur, minus Fahrtwind, minus dein gelerntes Kälteempfinden */
export const feelOnBike = (h: { t: number; ta: number }, speed: number, bias = 0) => r1(h.ta - rideChill(speed, h.t) - bias);

/** Grundstufe für eine gefühlte Temperatur */
export function levelFor(f: number, lv: WearCfg["lv"]): Lvl {
  for (const id of ["kk", "kl", "lk", "ll"] as const) { const x = lv[id]; if (x != null && f >= x) return id; }
  return "wi";
}
/** Regel als Text („Wind ab 20 km/h und gefühlt unter 18 °C“) */
export function clauseText(c: Clause): string {
  const p: string[] = [];
  if (c.swap) p.push(c.swap === "top" ? "wenn es auf der Fahrt deutlich wärmer oder kühler wird und oben zwischen kurz und lang liegt" : "wenn es auf der Fahrt deutlich wärmer oder kühler wird und unten zwischen kurz und lang liegt");
  if (c.below != null) p.push(`gefühlt unter ${fmt(c.below)} °C`);
  if (c.from != null) p.push(`gefühlt ab ${fmt(c.from)} °C`);
  if (c.startBelow != null) p.push(`anfangs gefühlt unter ${fmt(c.startBelow)} °C`);
  if (c.warmer != null) p.push(`es wird um ${fmt(c.warmer)} °C wärmer`);
  if (c.wind != null) p.push(`Wind ab ${fmt(c.wind)} km/h`);
  if (c.gust != null) p.push(`Böen ab ${fmt(c.gust)} km/h`);
  if (c.rain != null) p.push(`Regenrisiko ab ${fmt(c.rain)} % oder Regen`);
  if (c.wet) p.push("bei Nässe (Regen oder nasse Straße)");
  if (c.dark) p.push("im Dunkeln");
  return p.join(" und ") || "immer";
}
export const itemRuleText = (it: Item) => (it.rules.length ? it.rules.map(clauseText).join(" – oder – ") : "nie");

/** Was eine Fahrt ab Stunde i mit dieser Dauer erwartet */
export interface Ride {
  f: number[]; fStart: number; fEnd: number; fMin: number; fMax: number; fAvg: number; // gefühlt auf dem Rad je Stunde (nass: kälter)
  t: [number, number]; ta: [number, number]; chill: number;
  ws: number; wg: number; pp: number; p: number; wet: boolean; rain: boolean; dark: boolean; wdir: number;
}
export function rideAt(hs: Hour[], film: number[], i: number, dur: number, cfg: WearCfg, bias = 0): Ride | null {
  const n = Math.max(1, Math.ceil(dur / 60));
  const part = hs.slice(i, i + n);
  if (!part.length) return null;
  // Nasse Stunden (Regen ab 0,3 mm oder Regenrisiko ab wetProb) kühlen zusätzlich: nasse Kleidung
  const wetH = (h: Hour) => h.p >= 0.3 || h.pp >= cfg.wetProb;
  const f = part.map((h) => r1(feelOnBike(h, cfg.speed, bias) - (wetH(h) ? cfg.wetCold : 0)));
  const wm = windMean(part);
  const p = Math.max(...part.map((h) => h.p)), pp = Math.max(...part.map((h) => h.pp));
  const rain = part.some(wetH);
  const wetRoad = part.some((h, k) => roadState(film[i + k] ?? 0, h.p) === "nass");
  return {
    f, fStart: f[0], fEnd: f[f.length - 1], fMin: Math.min(...f), fMax: Math.max(...f), fAvg: r1(f.reduce((s, x) => s + x, 0) / f.length),
    t: [Math.min(...part.map((h) => h.t)), Math.max(...part.map((h) => h.t))], ta: [Math.min(...part.map((h) => h.ta)), Math.max(...part.map((h) => h.ta))],
    chill: r1(part.reduce((s, h) => s + rideChill(cfg.speed, h.t), 0) / part.length),
    ws: wm.ws, wg: wm.wg, pp, p, wet: rain || wetRoad, rain, dark: part.some((h) => h.light < 30), wdir: wm.dir,
  };
}

export interface WearItem { id: string; name: string; part: string | null; why: string }
export interface Wear {
  lvl: Lvl; name: string; desc: string; top: Cover; legs: Cover; why: string;
  items: WearItem[]; parts: string[]; ride: Ride;
}
/** Wert neben einer Grenze: mit Nachkommastelle, wenn er gerundet wie die Grenze aussähe („0,6 °C (unter 1)“) */
const vs = (v: number, thr: number) => (Math.round(v) === Math.round(thr) ? fmt(v, 1) : fmt(v));
/** Passende Bedingung eines Teils mit den Werten der Fahrt („Wind 24 km/h (ab 20)“), null wenn keine Regel greift */
function matchItem(it: Item, r: Ride, swap: { top: boolean; legs: boolean }): string | null {
  for (const c of it.rules) {
    const why: string[] = [];
    let ok = true;
    const test = (cond: boolean, text: string) => { if (!cond) ok = false; else why.push(text); };
    if (c.swap) test(c.swap === "top" ? swap.top : swap.legs, `anfangs gefühlt ${fmt(r.fStart)} °C, später ${fmt(r.fEnd)} °C: zum ${r.fEnd >= r.fStart ? "Ausziehen" : "Anziehen"} statt dickerer Stufe`);
    if (c.below != null) test(r.fMin < c.below, `gefühlt ${vs(r.fMin, c.below)} °C (unter ${fmt(c.below)})`);
    if (c.from != null) test(r.fMax >= c.from, `gefühlt ${vs(r.fMax, c.from)} °C (ab ${fmt(c.from)})`);
    if (c.startBelow != null) test(r.fStart < c.startBelow, `anfangs ${vs(r.fStart, c.startBelow)} °C (unter ${fmt(c.startBelow)})`);
    if (c.warmer != null) test(r.fMax - r.fStart >= c.warmer, `wird ${fmt(r.fMax - r.fStart)} °C wärmer (ab ${fmt(c.warmer)})`);
    if (c.wind != null) test(r.ws >= c.wind, `Wind ${r.ws} km/h (ab ${fmt(c.wind)})`);
    if (c.gust != null) test(r.wg >= c.gust, `Böen ${r.wg} km/h (ab ${fmt(c.gust)})`);
    if (c.rain != null) test(r.pp >= c.rain || r.p >= 0.3, r.p >= 0.3 ? `Regen ${fmt(r.p, 1)} mm` : `Regenrisiko ${r.pp} % (ab ${fmt(c.rain)})`);
    if (c.wet) test(r.wet, r.rain ? "Regen" : "Straße nass");
    if (c.dark) test(r.dark, "teils im Dunkeln");
    if (ok && why.length) return why.join(", ");
  }
  return null;
}
/** Teile, die ein anderes ersetzt (lange Handschuhe statt kurzer, Regenjacke statt Wind-/Gilet …) */
function resolve(ids: Set<string>, top: Cover, legs: Cover) {
  if (ids.has("handschuhLang")) ids.delete("handschuhKurz");
  if (ids.has("regenjacke")) { ids.delete("windjacke"); ids.delete("gilet"); }
  if (ids.has("windjacke")) ids.delete("gilet");
  if (top === "winter") { ids.delete("windjacke"); ids.delete("gilet"); }
  if (top !== "kurz") ids.delete("armlinge");
  if (legs !== "kurz") { ids.delete("knielinge"); ids.delete("beinlinge"); }
  if (ids.has("beinlinge")) ids.delete("knielinge");
}
/**
 * Kleidung für eine Fahrt. Grundstufe nach dem kältesten Moment (gefühlt auf dem Rad). Wird es auf der Fahrt um mindestens
 * `swing` °C wärmer oder kühler, zählt der Schnitt, und Armlinge bzw. Beinlinge überbrücken den kalten Teil (abnehmbar statt
 * dickerer Stufe). Regen: nasse Stunden zählen kälter (wetCold). Dann die Zusatzteile nach ihren Regeln.
 */
export function wearFor(hs: Hour[], film: number[], i: number, dur: number, cfg: WearCfg, bias = 0): Wear | null {
  const r = rideAt(hs, film, i, dur, cfg, bias);
  if (!r) return null;
  const cold = levelFor(r.fMin, cfg.lv), avg = levelFor(r.fAvg, cfg.lv);
  const swinging = r.fMax - r.fMin >= cfg.swing && cold !== avg;
  const base: Lvl = swinging ? avg : cold;
  const notes: string[] = [];
  const lows = Object.values(cfg.lv).filter(isNum);
  const lvTxt = (id: Lvl) => (id !== "wi" ? `ab ${fmt(cfg.lv[id] as number)} °C` : lows.length ? `unter ${fmt(Math.min(...lows))} °C` : "immer");
  if (swinging) notes.push(`Es wird auf der Fahrt um ${fmt(r.fMax - r.fMin)} °C ${r.fEnd >= r.fStart ? "wärmer" : "kühler"} (gefühlt ${fmt(r.fMin)} bis ${fmt(r.fMax)} °C): Grundstufe nach dem Schnitt von ${fmt(r.fAvg)} °C (${LV[base].name} ${lvTxt(base)}), dazu Teile zum ${r.fEnd >= r.fStart ? "Ausziehen" : "Anziehen"}.`);
  else notes.push(`Gefühlt auf dem Rad ${fmt(r.fMin) === fmt(r.fMax) ? fmt(r.fMin) : fmt(r.fMin) + " bis " + fmt(r.fMax)} °C: ${LV[base].name} (${lvTxt(base)}).`);
  if (r.rain && cfg.wetCold > 0) notes.push(`Regen erwartet: nasse Stunden ${fmt(cfg.wetCold)} °C kälter gerechnet, nasse Kleidung kühlt.`);
  const b = LV[base], c = LV[cold];
  const swap = { top: swinging && COVER_RANK[c.top] > COVER_RANK[b.top], legs: swinging && COVER_RANK[c.legs] > COVER_RANK[b.legs] };
  const found = new Map<string, string>();
  for (const it of cfg.items) {
    if (!it.on) continue;
    const why = matchItem(it, r, swap);
    if (why) found.set(it.id, why);
  }
  const ids = new Set(found.keys());
  resolve(ids, b.top, b.legs);
  const items = cfg.items.filter((it) => ids.has(it.id)).map((it) => ({ id: it.id, name: it.name, part: it.part, why: found.get(it.id) as string }));
  const parts = [{ kurz: "trikotKurz", lang: "trikotLang", winter: "jackeWinter" }[b.top], { kurz: "hoseKurz", lang: "hoseLang", winter: "hoseWinter" }[b.legs], ...items.map((x) => x.part).filter((x): x is string => !!x)];
  return { lvl: base, name: b.name, desc: b.desc, top: b.top, legs: b.legs, why: notes.join(" "), items, parts, ride: r };
}
/** Kurzform für Mitteilungen: „lang-kurz, Gilet, Handschuhe lang“ */
export const wearShort = (w: Wear) => [w.name, ...w.items.filter((x) => x.part || x.id === "licht").map((x) => x.name)].join(", ");

/** Kleidungs-Einstellungen aus der Oberfläche prüfen; eigene Teile höchstens 12 */
export function cleanWear(x: any): WearCfg {
  const d = DEFAULT_WEAR;
  if (!x || typeof x !== "object") return JSON.parse(JSON.stringify(d));
  const lv: WearCfg["lv"] = { ...d.lv };
  for (const k of ["kk", "kl", "lk", "ll"] as const) {
    const v = x.lv?.[k];
    lv[k] = v === null ? null : v === undefined ? d.lv[k] : r1(numIn(v, -25, 35, d.lv[k] ?? 0));
  }
  // Grenzen müssen von leicht nach warm fallen; sonst die Vorschläge
  const on = (["kk", "kl", "lk", "ll"] as const).filter((k) => lv[k] != null).map((k) => lv[k] as number);
  const sorted = on.every((v, i) => i === 0 || v < on[i - 1]);
  const items: Item[] = [];
  const src: unknown[] = Array.isArray(x.items) ? x.items : d.items;
  for (const raw of src) {
    const it = raw as any;
    if (!it || typeof it !== "object" || typeof it.id !== "string") continue;
    const base = d.items.find((y) => y.id === it.id);
    const own = !base;
    if (own && (!/^e\w{1,15}$/.test(it.id) || items.filter((y) => y.own).length >= 12)) continue;
    if (items.some((y) => y.id === it.id)) continue;
    const name = own ? String(it.name || "").replace(/\s+/g, " ").trim().slice(0, 30) : base!.name;
    if (!name) continue;
    const rules = Array.isArray(it.rules) ? it.rules.slice(0, 2).map(cleanClause).filter((c: Clause | null): c is Clause => !!c) : base ? base.rules : [];
    items.push({ id: it.id, name, part: own ? null : base!.part, on: it.on !== false, rules: rules.length ? rules : base ? base.rules : [], ...(own ? { own: true } : {}) });
  }
  // Fehlende Standard-Teile (neue Version) hinten anfügen
  for (const it of d.items) if (!items.some((y) => y.id === it.id)) items.push({ ...it });
  return {
    speed: Math.round(numIn(x.speed, 0, 60, d.speed)),
    lv: sorted && on.length ? lv : { ...d.lv },
    swing: r1(numIn(x.swing, 2, 15, d.swing)),
    wetCold: r1(numIn(x.wetCold, 0, 8, d.wetCold)),
    wetProb: Math.round(numIn(x.wetProb, 10, 100, d.wetProb)),
    dur: Math.round(numIn(x.dur, 30, 480, d.dur) / 30) * 30,
    items,
  };
}
function cleanClause(c: any): Clause | null {
  if (!c || typeof c !== "object") return null;
  const o: Clause = {};
  const n = (k: keyof Clause, a: number, b: number) => { const v = c[k]; if (v !== undefined && v !== null && v !== "" && isNum(Number(v))) (o as any)[k] = r1(clamp(Number(v), a, b)); };
  n("below", -30, 40); n("from", -30, 40); n("wind", 0, 120); n("gust", 0, 150); n("rain", 0, 100); n("warmer", 1, 30); n("startBelow", -30, 40);
  if (c.wet === true) o.wet = true;
  if (c.dark === true) o.dark = true;
  if (c.swap === "top" || c.swap === "legs") o.swap = c.swap;
  return Object.keys(o).length ? o : null;
}

// ---------- Rückmeldung nach der Fahrt ----------
/** Rückmeldung zu einer Fahrt: −1 zu kalt, 0 passt, 1 zu warm. f = gefühlt auf dem Rad (falls bekannt), lvl = empfohlene Stufe */
export interface Fb { id: string; d: string; v: -1 | 0 | 1; f?: number | null; lvl?: Lvl | null }
export const LEARN_STEP = 0.5, LEARN_MAX = 4;
/**
 * Gelerntes Kälteempfinden: Jedes „zu kalt“ rechnet für dich 0,5 °C kälter (alle Grenzen rücken nach oben), jedes „zu warm“
 * 0,5 °C wärmer, höchstens ±4 °C. „Passt“ ändert nichts. Aus der Liste neu gerechnet, damit es nachvollziehbar bleibt.
 */
export function learned(list: Fb[]): { bias: number; moves: Array<{ id: string; d: string; v: number; f: number | null; to: number }> } {
  let bias = 0;
  const moves: Array<{ id: string; d: string; v: number; f: number | null; to: number }> = [];
  for (const x of [...list].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))) {
    if (x.v === 0) continue;
    const next = clamp(bias + (x.v < 0 ? LEARN_STEP : -LEARN_STEP), -LEARN_MAX, LEARN_MAX);
    if (next === bias) continue;
    bias = next;
    moves.push({ id: x.id, d: x.d, v: x.v, f: x.f ?? null, to: bias });
  }
  return { bias, moves };
}
export const learnText = (bias: number) => (bias === 0 ? "Noch nichts verschoben." : bias > 0
  ? `Du frierst schneller als die Vorschläge: Die App rechnet für dich ${fmt(bias, 1)} °C kälter.`
  : `Dir wird schneller warm als in den Vorschlägen: Die App rechnet für dich ${fmt(-bias, 1)} °C wärmer.`);
/** Treffsicherheit (letzte 10), aktuelle und längste „passt“-Serie */
export function wardrobe(list: Fb[]): { n: number; ok: number; quote: number | null; streak: number; best: number } {
  const s = [...list].sort((a, b) => (a.d < b.d ? -1 : 1));
  const last = s.slice(-10), ok = last.filter((x) => x.v === 0).length;
  let streak = 0;
  for (let i = s.length - 1; i >= 0 && s[i].v === 0; i--) streak++;
  let best = 0, run = 0;
  for (const x of s) { run = x.v === 0 ? run + 1 : 0; best = Math.max(best, run); }
  return { n: s.length, ok, quote: last.length ? Math.round((ok / last.length) * 100) : null, streak, best };
}

// ---------- Mitteilungen ----------
export interface PushOpt { announce: boolean; remind: number } // Ankündigen; Erinnerung Minuten vorher (0 = aus)
export interface PushState { day?: string; n?: number; last?: number; known?: Array<[number, number]>; rem?: number[] }
export type RwPush = "neu" | "anders" | "weg" | "los";
/** Nicht nachts: Ankündigungen 07–21 Uhr, Erinnerungen 06–21:30 Uhr; höchstens 2 Ankündigungen am Tag, 3 h Abstand */
export const RW_PUSH = { from: "07:00", until: "21:00", remFrom: "06:00", remUntil: "21:30", maxDay: 2, gap: 3 * 3600, change: 2 * 3600, horizon: 48 * 3600 };
/**
 * Ist eine Mitteilung fällig? Höchstens eine je Lauf.
 * - „los“: ein Fenster beginnt in den nächsten `remind` Minuten (einmal je Fenster)
 * - „neu“: ein Fenster der nächsten 48 h, das noch nicht gemeldet wurde
 * - „anders“: ein gemeldetes Fenster hat sich um mindestens 2 h verschoben
 * - „weg“: ein gemeldetes Fenster der nächsten 36 h ist verschwunden
 */
export function pushPlan(wins: Win[], st: PushState, now: number, hm: string, today: string, opt: PushOpt): { kind: RwPush | null; win?: Win; old?: [number, number]; state: PushState } {
  const s: PushState = {
    day: today, n: st.day === today ? st.n || 0 : 0, last: st.last || 0,
    known: (st.known || []).filter((k) => k[1] > now), rem: (st.rem || []).filter((x) => x > now - 6 * 3600),
  };
  if (opt.remind > 0 && hm >= RW_PUSH.remFrom && hm <= RW_PUSH.remUntil) {
    const w = wins.find((x) => x.s > now && x.s - now <= opt.remind * 60 && !s.rem!.includes(x.s));
    if (w) { s.rem!.push(w.s); return { kind: "los", win: w, state: s }; }
  }
  if (!opt.announce || hm < RW_PUSH.from || hm > RW_PUSH.until || s.n! >= RW_PUSH.maxDay || now - s.last! < RW_PUSH.gap) return { kind: null, state: s };
  const future = wins.filter((w) => w.s > now + 45 * 60 && w.s < now + RW_PUSH.horizon);
  const overlap = (a: [number, number], w: Win) => w.s < a[1] && w.e > a[0];
  const events: Array<{ at: number; kind: RwPush; win?: Win; old?: [number, number] }> = [];
  for (const k of s.known!) {
    if (k[0] <= now + 30 * 60 || k[0] > now + 36 * 3600) continue;
    if (!wins.some((w) => overlap(k, w))) events.push({ at: k[0], kind: "weg", old: k });
  }
  for (const w of future) {
    const k = s.known!.find((x) => overlap(x, w));
    if (!k) events.push({ at: w.s, kind: "neu", win: w });
    else if (Math.abs(w.s - k[0]) >= RW_PUSH.change || Math.abs(w.e - k[1]) >= RW_PUSH.change) events.push({ at: w.s, kind: "anders", win: w, old: k });
  }
  if (!events.length) return { kind: null, state: s };
  events.sort((a, b) => a.at - b.at);
  const ev = events[0];
  if (ev.kind === "weg") s.known = s.known!.filter((k) => k !== ev.old);
  else if (ev.kind === "anders") s.known = [...s.known!.filter((k) => k !== ev.old), [ev.win!.s, ev.win!.e]];
  else s.known = [...s.known!, [ev.win!.s, ev.win!.e]];
  s.n = s.n! + 1; s.last = now;
  return { kind: ev.kind, win: ev.win, old: ev.old, state: s };
}
/** Text der Mitteilung (Emojis nur hier, nie in der Oberfläche) */
export function pushMsg(kind: RwPush, ctx: { today: string; now: number; win?: Win; old?: [number, number]; oldText?: string; wear?: Wear | null; advice?: Advice | null; place?: string }): { title: string; body: string } {
  const w = ctx.win, where = ctx.place ? ` (${ctx.place})` : "";
  const day = (x: Win) => { const d = dayWord(x.d, ctx.today); return d === "heute" || d === "morgen" ? d : "am " + d; };
  const about = (x: Win) => `${fmt(x.t[0])}${x.t[1] !== x.t[0] ? "–" + fmt(x.t[1]) : ""} °C, Wind ${x.ws} km/h aus ${compassShort(x.wdir)}`;
  const wearTxt = ctx.wear ? ` Anziehen: ${wearShort(ctx.wear)}.` : "";
  if (kind === "los" && w) {
    const min = Math.max(1, Math.round((w.s - ctx.now) / 60));
    return { title: `⏱ In ${min} Minuten geht's los${where}`, body: `Trocken bis ${w.h1 % 24 || 24} Uhr, ${about(w)}.${ctx.advice ? " " + ctx.advice.short : ""}${wearTxt}` };
  }
  if (kind === "neu" && w) {
    return { title: `🚴 Gutes Fenster ${day(w)}${where}`, body: `${capital(day(w))} ${winTime(w)}: trocken, ${about(w)}.${wearTxt}` };
  }
  if (kind === "anders" && w) {
    return { title: `🔄 Fenster verschoben${where}`, body: `Jetzt ${day(w)} ${winTime(w)}${ctx.oldText ? " statt " + ctx.oldText : ""}: ${about(w)}.` };
  }
  return { title: `🌧 Fenster fällt aus${where}`, body: `${ctx.oldText ? capital(ctx.oldText) + " wird" : "Das gemeldete Fenster wird"} laut Vorhersage nichts. Die App meldet sich, sobald sich ein neues zeigt.` };
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Dranbleiben: genutzte Fenster, Wochenziel, Serie, Abzeichen ----------
/** Eine echte Radfahrt (Garmin, Strava …): Start als „HH:MM“ Ortszeit, Wetter zur Mitte der Fahrt (#54), falls geholt */
export interface RideAct { id: string; date: string; start: string; min: number; km: number; name?: string; wx?: { t?: number | null; ta?: number | null; ws?: number | null; c?: number | null } | null }
/** Fenster eines Tages (Ortszeit) als [von, bis, Wertung], dazu Temperatur und gefühlt je Stunde für Rückmeldungen */
export interface LogDay { w: Array<[number, number, number]>; t?: Array<number | null>; ta?: Array<number | null> }
export type Log = Record<string, LogDay>;
/** Tagesweise Fenster und Stundenwerte aus der Vorhersage (für das Protokoll in kv) */
export function logDays(hs: Hour[], wins: Win[]): Log {
  const out: Log = {};
  for (const h of hs) {
    const day = out[h.d] || (out[h.d] = { w: [], t: new Array(24).fill(null), ta: new Array(24).fill(null) });
    day.t![h.h] = h.t; day.ta![h.h] = h.ta;
  }
  for (const w of wins) {
    // Über Mitternacht: je Tag ein Stück
    let s = w.s;
    while (s < w.e) {
      const k = hs.findIndex((h) => h.e === s);
      if (k < 0) break;
      const d = hs[k].d;
      let j = k;
      while (j + 1 < hs.length && hs[j + 1].d === d && hs[j + 1].e < w.e) j++;
      out[d]?.w.push([hs[k].h, hs[j].h + 1, w.score]);
      s = hs[j].e + 3600;
    }
  }
  // Tage, die nur teilweise in den Daten liegen, nicht mit leeren Fenstern überschreiben
  return out;
}
/** Protokoll zusammenführen: neuere Stunden ersetzen ältere, höchstens `keep` Tage */
export function mergeLog(old: Log, fresh: Log, keep = 400): Log {
  const out: Log = { ...old };
  for (const [d, v] of Object.entries(fresh)) {
    const prev = out[d];
    const filled = (v.t || []).filter((x) => x != null).length;
    // Unvollständiger Tag (Anfang oder Ende der Vorhersage): Stundenwerte ergänzen, Fenster nur ersetzen, wenn mind. 12 h da sind
    const t = (prev?.t || new Array(24).fill(null)).map((x: number | null, i: number) => (v.t?.[i] ?? x));
    const ta = (prev?.ta || new Array(24).fill(null)).map((x: number | null, i: number) => (v.ta?.[i] ?? x));
    out[d] = { w: !prev || filled >= 12 ? v.w : prev.w, t, ta };
  }
  const days = Object.keys(out).sort();
  for (const d of days.slice(0, Math.max(0, days.length - keep))) delete out[d];
  return out;
}
export const weekOf = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
const RAIN = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOW = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;

/** Startet eine Fahrt in einem Fenster (spätestens eine halbe Stunde vor dessen Ende, frühestens eine halbe Stunde vorher)? */
export function usedWindows(rides: RideAct[], log: Log): Array<{ d: string; h0: number; h1: number; score: number; ride: string }> {
  const out: Array<{ d: string; h0: number; h1: number; score: number; ride: string }> = [];
  for (const r of [...rides].sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1))) {
    const day = log[r.date]; const h = hours(r.start);
    if (!day || !isNum(h)) continue;
    const w = day.w.find((x) => h >= x[0] - 0.5 && h <= x[1] - 0.5);
    if (w && !out.some((u) => u.d === r.date && u.h0 === w[0])) out.push({ d: r.date, h0: w[0], h1: w[1], score: w[2], ride: r.id });
  }
  return out;
}
export interface Challenge { goal: number; target: number; avail: number; ahead: number; used: number; done: boolean }
/** Wochenziel: so viele gute Fenster nutzen, wie es gibt, höchstens `goal`. ahead = Fenster, die diese Woche noch kommen */
export function challenge(log: Log, used: ReturnType<typeof usedWindows>, today: string, goal: number, nowH: number): Challenge {
  const mon = weekOf(today), sun = addDays(mon, 6);
  let avail = 0, ahead = 0;
  for (const [d, v] of Object.entries(log)) {
    if (d < mon || d > sun) continue;
    avail += v.w.length;
    ahead += v.w.filter((w) => d > today || (d === today && w[1] - 0.5 > nowH)).length;
  }
  const u = used.filter((x) => x.d >= mon && x.d <= sun).length;
  const target = Math.min(goal, avail);
  return { goal, target, avail, ahead, used: u, done: target > 0 && u >= target };
}
/**
 * Serie: Wochen in Folge mit mindestens einem genutzten Fenster. Wochen ganz ohne gutes Fenster zählen nicht und brechen
 * die Serie nicht (Schlechtwetter ist keine Ausrede, aber auch kein Versagen). Die laufende Woche zählt, sobald genutzt.
 */
export function streak(log: Log, used: ReturnType<typeof usedWindows>, today: string): { cur: number; best: number; since: string | null } {
  const days = Object.keys(log).sort();
  if (!days.length) return { cur: 0, best: 0, since: null };
  const thisWeek = weekOf(today);
  const weeks: Array<{ w: string; avail: number; used: number }> = [];
  for (let w = weekOf(days[0]); w <= thisWeek; w = addDays(w, 7)) {
    let avail = 0;
    for (let i = 0; i < 7; i++) { const d = addDays(w, i); if (d <= today && log[d]) avail += log[d].w.length; }
    weeks.push({ w, avail, used: used.filter((u) => weekOf(u.d) === w).length });
  }
  let best = 0, run = 0;
  for (const x of weeks) {
    if (x.used) run++;
    else if (x.avail && x.w !== thisWeek) run = 0;
    best = Math.max(best, run);
  }
  let cur = 0;
  for (let k = weeks.length - 1; k >= 0; k--) {
    const x = weeks[k];
    if (x.used) cur++;
    else if (x.w === thisWeek || !x.avail) continue;
    else break;
  }
  return { cur, best, since: days[0] };
}

export interface Badge { id: string; name: string; icon: string; rule: string; unit: string; tiers: number[]; n: number; tier: number; next: number | null; wx: boolean; last: string | null }
const BADGES: Array<{ id: string; name: string; icon: string; rule: string; unit: string; tiers: number[]; wx: boolean }> = [
  { id: "fenster", name: "Fensterjäger", icon: "zielscheibe", rule: "Fahrt, die in einem guten Fenster startet (je Fenster einmal).", unit: "Fenster", tiers: [3, 10, 30], wx: false },
  { id: "perfekt", name: "Perfektes Fenster", icon: "auszeichnung", rule: "Fahrt im besten Fenster der Woche (höchste Wertung).", unit: "Wochen", tiers: [1, 5, 15], wx: false },
  { id: "frueh", name: "Frühaufsteher", icon: "sonnenaufgang", rule: "Start vor 7 Uhr.", unit: "Fahrten", tiers: [1, 10, 30], wx: false },
  { id: "ganzjahr", name: "Ganzjahr", icon: "kalender", rule: "Monate mit mindestens einer Fahrt in den letzten 12 Monaten.", unit: "Monate", tiers: [6, 9, 12], wx: false },
  { id: "regen", name: "Regenradler", icon: "schirm", rule: "Fahrt bei Regen (Wetter zur Mitte der Fahrt).", unit: "Fahrten", tiers: [1, 5, 15], wx: true },
  { id: "wind", name: "Gegenwind", icon: "wind", rule: "Fahrt bei Wind ab 25 km/h.", unit: "Fahrten", tiers: [1, 5, 15], wx: true },
  { id: "kalt", name: "Kälteprofi", icon: "schneeflocke", rule: "Fahrt bei höchstens 3 °C.", unit: "Fahrten", tiers: [1, 5, 15], wx: true },
  { id: "hitze", name: "Hitzefest", icon: "flamme", rule: "Fahrt bei mindestens 28 °C.", unit: "Fahrten", tiers: [1, 5, 15], wx: true },
  { id: "allwetter", name: "Allwetter", icon: "regenbogen", rule: "Verschiedene Wetterlagen gefahren: Sonne, Wolken, Nebel, Regen, Schnee, Frost (ab 0 °C abwärts), Hitze (ab 28 °C), Sturm (ab 35 km/h).", unit: "von 8 Wetterlagen", tiers: [3, 5, 7], wx: true },
  { id: "garderobe", name: "Perfekt angezogen", icon: "kleiderbuegel", rule: "Rückmeldung „passt“ mehrmals hintereinander (längste Serie).", unit: "in Folge", tiers: [3, 5, 10], wx: false },
];
/** Abzeichen mit offenen Regeln, Stufen I–III und Fortschritt zur nächsten Stufe */
export function badges(rides: RideAct[], used: ReturnType<typeof usedWindows>, log: Log, fb: Fb[], today: string): Badge[] {
  const lastOf = (list: RideAct[]) => (list.length ? list.map((r) => r.date).sort().pop() || null : null);
  const wx = rides.filter((r) => r.wx && isNum(r.wx.t));
  // Bestes Fenster jeder Woche aus dem Protokoll
  const bestOfWeek = new Map<string, { d: string; h0: number; score: number }>();
  for (const [d, v] of Object.entries(log)) for (const w of v.w) {
    const k = weekOf(d), b = bestOfWeek.get(k);
    if (!b || w[2] > b.score) bestOfWeek.set(k, { d, h0: w[0], score: w[2] });
  }
  const perfect = used.filter((u) => { const b = bestOfWeek.get(weekOf(u.d)); return b && b.d === u.d && b.h0 === u.h0; });
  const yearAgo = addDays(today, -365);
  const months = new Set(rides.filter((r) => r.date > yearAgo && r.date <= today).map((r) => r.date.slice(0, 7)));
  const kinds = new Set<string>();
  for (const r of wx) {
    const w = r.wx!, c = isNum(w.c) ? w.c : -1, t = w.t as number;
    if (c >= 0 && c <= 2) kinds.add("sonne"); if (c === 3) kinds.add("wolken"); if (c === 45 || c === 48) kinds.add("nebel");
    if (RAIN(c)) kinds.add("regen"); if (SNOW(c)) kinds.add("schnee"); if (t <= 0) kinds.add("frost"); if (t >= 28) kinds.add("hitze");
    if (isNum(w.ws) && w.ws >= 35) kinds.add("sturm");
  }
  const sel: Record<string, { n: number; last: string | null }> = {
    fenster: { n: used.length, last: used.length ? used[used.length - 1].d : null },
    perfekt: { n: perfect.length, last: perfect.length ? perfect[perfect.length - 1].d : null },
    frueh: (() => { const l = rides.filter((r) => hours(r.start) < 7); return { n: l.length, last: lastOf(l) }; })(),
    ganzjahr: { n: months.size, last: lastOf(rides.filter((r) => r.date > yearAgo)) },
    regen: (() => { const l = wx.filter((r) => RAIN(isNum(r.wx!.c) ? r.wx!.c : -1)); return { n: l.length, last: lastOf(l) }; })(),
    wind: (() => { const l = wx.filter((r) => isNum(r.wx!.ws) && (r.wx!.ws as number) >= 25); return { n: l.length, last: lastOf(l) }; })(),
    kalt: (() => { const l = wx.filter((r) => (r.wx!.t as number) <= 3); return { n: l.length, last: lastOf(l) }; })(),
    hitze: (() => { const l = wx.filter((r) => (r.wx!.t as number) >= 28); return { n: l.length, last: lastOf(l) }; })(),
    allwetter: { n: kinds.size, last: lastOf(wx) },
    garderobe: { n: wardrobe(fb).best, last: null },
  };
  return BADGES.map((b) => {
    const s = sel[b.id] || { n: 0, last: null };
    const tier = b.tiers.filter((t) => s.n >= t).length;
    return { ...b, n: s.n, tier, next: tier < b.tiers.length ? b.tiers[tier] : null, last: s.last };
  });
}
/** Wetter-Rekorde aus den eigenen Fahrten (nur mit Wetter je Einheit, #54) */
export function records(rides: RideAct[]): Array<{ key: string; label: string; value: string; d: string; id: string }> {
  const wx = rides.filter((r) => r.wx && isNum(r.wx.t));
  const out: Array<{ key: string; label: string; value: string; d: string; id: string }> = [];
  const pick = (key: string, label: string, list: RideAct[], val: (r: RideAct) => number, better: (a: number, b: number) => boolean, txt: (v: number) => string) => {
    let best: RideAct | null = null;
    for (const r of list) if (!best || better(val(r), val(best))) best = r;
    if (best) out.push({ key, label, value: txt(val(best)), d: best.date, id: best.id });
  };
  pick("kalt", "Kälteste Fahrt", wx, (r) => r.wx!.t as number, (a, b) => a < b, (v) => fmt(v) + " °C");
  pick("warm", "Wärmste Fahrt", wx, (r) => r.wx!.t as number, (a, b) => a > b, (v) => fmt(v) + " °C");
  pick("wind", "Windigste Fahrt", wx.filter((r) => isNum(r.wx!.ws)), (r) => r.wx!.ws as number, (a, b) => a > b, (v) => fmt(v) + " km/h");
  pick("frueh", "Frühester Start", rides.filter((r) => isNum(hours(r.start))), (r) => hours(r.start), (a, b) => a < b, (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")} Uhr`);
  return out;
}
export const dayShort = (d: string) => DAY_SHORT[new Date(d + "T12:00:00Z").getUTCDay()];
