// Freunde und Rangliste (#87), reine Funktionen (getestet in test/freunde.test.ts), bewusst ohne Importe.
// Jede Instanz bleibt für sich (kein zentraler Server). Wer teilen will, gibt unter Konto → Freunde einzelne Gruppen frei;
// ein geheimer Link (Adresse + Token) liefert nur diese kleine Zusammenfassung. Nie dabei: Stimmung, Schlaf, HRV, Ruhepuls,
// Gewicht, Routen, Rohdaten, und keine Einheiten aus Strava, WHOOP oder Google Health (deren API-Bedingungen verbieten die Weitergabe).

/** Freigaben je Gruppe; Standard: alles aus */
/** akt = letzte Aktivitäten mit Route (ohne die ersten und letzten 200 m) */
export interface Share { umfang: boolean; best: boolean; watt: boolean; vo2: boolean; bild: boolean; akt: boolean }
export const DEFAULT_SHARE: Share = { umfang: false, best: false, watt: false, vo2: false, bild: false, akt: false };
/** Eine geteilte Aktivität fürs Profil (#87): Kennzahlen und gekürzte Route [[Breite, Länge], …] */
export interface FriendAct { id: string; date: string; type: string; name?: string; km?: number; min?: number; hm?: number; hr?: number; route?: Array<[number, number]> }
export const MAX_ACTS = 10;
const PRIVACY_M = 200, ROUTE_PTS = 200;

/** Summen je Zeitraum: km, Stunden, Höhenmeter, Anzahl Einheiten */
export interface Sum { km: number; h: number; hm: number; n: number }
export interface SportSummary {
  w?: Sum; m?: Sum; y?: Sum;
  /** Bestzeiten in Sekunden je Strecke (Meter), gesamt und dieses Jahr */
  best?: { all: Record<string, number>; year: Record<string, number> };
  /** Höchste Durchschnittsleistung in Watt je Zeitfenster (Sekunden), nur Rad */
  watt?: { all: Record<string, number>; year: Record<string, number> };
  /** Dasselbe in Watt pro Kilo, mit dem Gewicht zur Zeit der Fahrt (fair zwischen leichten und schweren Fahrern) */
  wkg?: { all: Record<string, number>; year: Record<string, number> };
}
/** fol/fing = Anzahl Follower bzw. Gefolgt (immer dabei, wie der Name; nur Zahlen, keine Namen) */
export interface FriendSummary { v: 1; name: string; img?: string; at: string; vo2?: number; run?: SportSummary; ride?: SportSummary; acts?: FriendAct[]; fol?: number; fing?: number }

type Act = Record<string, any> & { date: string; type?: string };
const RUN = /running|trail|treadmill/;
const RIDE = /cycl|biking|bike|_ride|ride$/;
export const sportKey = (type: string | undefined): "run" | "ride" | null => (!type ? null : RUN.test(type) ? "run" : RIDE.test(type) ? "ride" : null);

const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monday = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
const r1 = (x: number) => Math.round(x * 10) / 10;
// Garmins schnellste Abschnitte aus der Aktivitätsliste als Ausweich, solange die .fit noch nicht ausgewertet ist
const GARMIN_BEST: Record<string, string> = { "5000": "f5k", "10000": "f10k", "21097": "fHm", "42195": "fM" };

/** Abstand zweier Punkte in Metern (Haversine) */
function dist(a: [number, number], b: [number, number]) {
  const R = 6371000, rad = Math.PI / 180, dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/**
 * Route zum Teilen: die ersten und letzten 200 m weg (Haustür), auf höchstens 200 Punkte ausgedünnt, 5 Nachkommastellen
 * (~1 m). Zu kurz (unter 1 km nach dem Kürzen) = gar keine Route.
 */
export function shareRoute(route: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(route)) return undefined;
  const pts = route.filter((p): p is [number, number] => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
  if (pts.length < 2) return undefined;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total - 2 * PRIVACY_M < 1000) return undefined;
  const inner = pts.filter((_, i) => cum[i] >= PRIVACY_M && cum[i] <= total - PRIVACY_M);
  const step = Math.max(1, Math.ceil(inner.length / ROUTE_PTS));
  const out = inner.filter((_, i) => i % step === 0 || i === inner.length - 1);
  return out.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
}

function sums(list: Act[]): Sum {
  const s = { km: 0, h: 0, hm: 0, n: 0 };
  for (const a of list) { s.km += a.km || 0; s.h += (a.min || 0) / 60; s.hm += a.elev || 0; s.n++; }
  return { km: r1(s.km), h: r1(s.h), hm: Math.round(s.hm), n: s.n };
}
/** Gewicht am Tag d: nächste Messung bis 30 Tage davor oder danach, sonst die letzte vor d (Liste aufsteigend nach Tag) */
export function weightAt(weights: Array<{ d: string; kg: number }>, d: string): number | null {
  let best: { d: string; kg: number } | null = null, dist = Infinity;
  const t = Date.parse(d + "T12:00:00Z");
  for (const w of weights) {
    const x = Math.abs(Date.parse(w.d + "T12:00:00Z") - t) / 864e5;
    if (x <= 30 && x < dist) { best = w; dist = x; }
  }
  if (best) return best.kg;
  const before = weights.filter((w) => w.d <= d);
  return before.length ? before[before.length - 1].kg : weights.length ? weights[0].kg : null;
}
/** Beste W/kg je Zeitfenster: Watt der Fahrt geteilt durch das Gewicht an ihrem Tag */
export function wkgBests(list: Act[], weights: Array<{ d: string; kg: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list) {
    const p = a.bst && a.bst.p; if (!p) continue;
    const kg = weightAt(weights, a.date); if (!kg || kg < 30 || kg > 250) continue;
    for (const [k, w] of Object.entries(p)) { const v = Math.round((Number(w) / kg) * 100) / 100; if (v > 0 && (out[k] == null || v > out[k])) out[k] = v; }
  }
  return out;
}

function bests(list: Act[], key: "d" | "p", run: boolean): Record<string, number> {
  const out: Record<string, number> = {};
  const better = (k: string, v: number) => { if (v > 0 && (out[k] == null || (key === "p" ? v > out[k] : v < out[k]))) out[k] = v; };
  for (const a of list) {
    const b = a.bst && a.bst[key];
    if (b) for (const [k, v] of Object.entries(b)) better(k, Number(v));
    if (key === "d" && run) for (const [k, f] of Object.entries(GARMIN_BEST)) if (a[f]) better(k, Number(a[f]));
  }
  return out;
}

/**
 * Zusammenfassung zum Teilen aus den eigenen Einheiten (`acts` wie in /api/data). Nur die freigegebenen Gruppen sind enthalten.
 * `today` = heute in Ortszeit (YYYY-MM-DD).
 */
export function summarize(acts: Act[], share: Share, me: { name?: string; img?: string | null }, today: string, vo2?: number | null, weights: Array<{ d: string; kg: number }> = [], routes: Record<string, unknown> = {}): FriendSummary {
  const out: FriendSummary = { v: 1, name: (me.name || "").trim() || "Ohne Namen", at: new Date().toISOString() };
  if (share.bild && me.img) out.img = me.img;
  if (share.vo2 && vo2 != null) out.vo2 = vo2;
  const own = acts.filter((a) => a.src !== "strava" && a.src !== "whoop" && a.src !== "google" && !a.hidden);
  const w0 = monday(today), m0 = today.slice(0, 8) + "01", y0 = today.slice(0, 5) + "01-01";
  for (const sport of ["run", "ride"] as const) {
    const list = own.filter((a) => sportKey(a.type) === sport && a.date <= today);
    if (!list.length) continue;
    const s: SportSummary = {};
    const year = list.filter((a) => a.date >= y0);
    if (share.umfang) { s.w = sums(list.filter((a) => a.date >= w0)); s.m = sums(list.filter((a) => a.date >= m0)); s.y = sums(year); }
    if (share.best) s.best = { all: bests(list, "d", sport === "run"), year: bests(year, "d", sport === "run") };
    if (share.watt && sport === "ride") {
      s.watt = { all: bests(list, "p", false), year: bests(year, "p", false) };
      if (weights.length) s.wkg = { all: wkgBests(list, weights), year: wkgBests(year, weights) };
    }
    if (Object.keys(s).length) out[sport] = s;
  }
  // Letzte Aktivitäten (alle Sportarten der eigenen Uhr), neueste zuerst, Route gekürzt
  if (share.akt) {
    out.acts = recentActs(own, today).map((a) => {
      const x: FriendAct = { id: String(a.id), date: a.date, type: String(a.type || "other").slice(0, 40) };
      if (a.name) x.name = String(a.name).slice(0, 60);
      if (a.km) x.km = r1(a.km);
      if (a.min) x.min = Math.round(a.min);
      if (a.elev) x.hm = Math.round(a.elev);
      if (a.hr) x.hr = Math.round(a.hr);
      const r = shareRoute(routes[String(a.id)]);
      if (r) x.route = r;
      return x;
    });
  }
  return out;
}
/** Die letzten Aktivitäten zum Teilen (eigene Uhr, nicht ausgeblendet), neueste zuerst */
export const recentActs = (own: Act[], today: string) =>
  own.filter((a) => a.id && a.date && a.date <= today).sort((a, b) => (a.date + (a.start || "") < b.date + (b.start || "") ? 1 : -1)).slice(0, MAX_ACTS);

/** Freundeslink zerlegen: https://adresse/f/<token> → { origin, token } (nur https, Token 32–64 Zeichen) */
export function parseLink(link: string): { origin: string; token: string } | null {
  let u: URL;
  try { u = new URL(String(link).trim()); } catch { return null; }
  const m = /^\/f\/([A-Za-z0-9_-]{32,64})\/?$/.exec(u.pathname);
  if (!m || (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
  return { origin: u.origin, token: m[1] };
}

/** Eingehende Zusammenfassung eines Freundes prüfen und auf bekannte Felder kürzen (fremde Instanz = fremde Daten) */
export function cleanSummary(x: unknown): FriendSummary | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, any>;
  if (o.v !== 1 || typeof o.name !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 && v < 1e7 ? v : undefined);
  const map = (m: unknown) => { const r: Record<string, number> = {}; if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) { if (/^\d{1,6}$/.test(k) && num(v) != null) r[k] = v as number; } return r; };
  const sum = (s: any): Sum | undefined => (s && typeof s === "object" ? { km: num(s.km) ?? 0, h: num(s.h) ?? 0, hm: num(s.hm) ?? 0, n: num(s.n) ?? 0 } : undefined);
  const sport = (s: any): SportSummary | undefined => {
    if (!s || typeof s !== "object") return undefined;
    const r: SportSummary = {};
    for (const k of ["w", "m", "y"] as const) { const v = sum(s[k]); if (v) r[k] = v; }
    if (s.best) r.best = { all: map(s.best.all), year: map(s.best.year) };
    if (s.watt) r.watt = { all: map(s.watt.all), year: map(s.watt.year) };
    if (s.wkg) r.wkg = { all: map(s.wkg.all), year: map(s.wkg.year) };
    return r;
  };
  const out: FriendSummary = { v: 1, name: o.name.slice(0, 40), at: typeof o.at === "string" ? o.at.slice(0, 30) : "" };
  if (typeof o.img === "string" && o.img.length < 300000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(o.img)) out.img = o.img;
  if (num(o.vo2) != null && o.vo2 < 100) out.vo2 = o.vo2;
  for (const k of ["fol", "fing"] as const) { const v = num(o[k]); if (v != null && v < 10000) out[k] = Math.round(v); }
  const run = sport(o.run), ride = sport(o.ride);
  if (run) out.run = run;
  if (ride) out.ride = ride;
  if (Array.isArray(o.acts)) {
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
    out.acts = o.acts.slice(0, MAX_ACTS).filter((a: any) => a && typeof a === "object" && typeof a.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date)).map((a: any) => {
      const x: FriendAct = { id: a.id.slice(0, 40), date: a.date, type: str(a.type, 40) || "other" };
      const nm = str(a.name, 60); if (nm) x.name = nm;
      for (const k of ["km", "min", "hm", "hr"] as const) { const v = num(a[k]); if (v != null) x[k] = v; }
      if (Array.isArray(a.route)) {
        const r = a.route.slice(0, 300).filter((p: any) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180).map((p: any) => [p[0], p[1]] as [number, number]);
        if (r.length >= 2) x.route = r;
      }
      return x;
    });
  }
  return out;
}
