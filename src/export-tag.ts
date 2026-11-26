// Tag exportieren (Konto → Datenquellen): alle Daten eines Tages als Datei, die die Person selbst weitergibt (z. B. damit
// Pablo und Eddie sehen, was Google Health liefert). Reine Hilfen, getestet in test/export-tag.test.ts. Bewusst ohne
// Importe mit Laufzeit-Code, damit die Tests die Datei direkt laden können. Abrufe und Datenbank: src/export-api.ts.

export const EXPORT_FORMAT = "health-hub-tag";
export const EXPORT_VERSION = 1;

/** Quellen, deren Bedingungen die Weitergabe verbieten (Strava) bzw. nur mit eigener Zustimmung erlauben (WHOOP): nie im Export */
export const EXCLUDED_SOURCES = ["strava", "whoop"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const pad = (x: number) => String(x).padStart(2, "0");

export const nextDay = (day: string) => {
  const t = new Date(day + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
/** Tage zwischen zwei Daten (JJJJ-MM-TT), b − a */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

// ---------- Gespeicherte Rohdaten (raw_records) ----------

/**
 * Gehört ein gespeicherter Rohdatensatz zum Tag? Nur Schlüssel „von_bis“ (Garmin: bis einschließlich, Google: bis
 * ausschließlich; der eine Tag zu viel fällt beim Kürzen mit trimToDay heraus). Andere Schlüssel (Withings: Stand_Seite)
 * sagen nichts über den Tag und bleiben draußen.
 */
export function rawTouches(key: string, day: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key);
  return !!m && m[1] <= day && day <= m[2];
}

/** Tag aus einem Datumswert: Text, der mit JJJJ-MM-TT beginnt, oder Googles {year, month, day} */
export function dayOf(v: unknown): string | null {
  if (typeof v === "string") return /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? null;
  if (isObj(v) && typeof v.year === "number" && typeof v.month === "number" && typeof v.day === "number") return `${v.year}-${pad(v.month)}-${pad(v.day)}`;
  return null;
}

/** Alle Tage, die irgendwo in einem Wert vorkommen (Texte und {year, month, day}, auch verschachtelt) */
export function daysIn(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12) return out;
  const d = dayOf(v);
  if (d) out.add(d);
  if (Array.isArray(v)) for (const x of v) daysIn(x, out, depth + 1);
  else if (isObj(v)) for (const x of Object.values(v)) daysIn(x, out, depth + 1);
  return out;
}

/** Felder mit dem Tag eines Eintrags (Garmin calendarDate, Google date): haben Vorrang vor allen anderen Zeitangaben */
const DAY_KEYS = ["calendarDate", "date", "summaryDate"];

/** Betrifft ein Eintrag den Tag? null = keine Zeitangabe gefunden (dann lässt sich nichts sagen) */
export function touchesDay(el: unknown, day: string): boolean | null {
  if (isObj(el)) for (const k of DAY_KEYS) { const d = dayOf(el[k]); if (d) return d === day; }
  const days = daysIn(el);
  return days.size ? days.has(day) : null;
}

/**
 * Rohantwort auf einen Tag kürzen: In jeder Liste von Einträgen bleiben nur die, die den Tag betreffen (Einträge ohne
 * Zeitangabe bleiben, man weiß es nicht). Ein Eintrag bleibt ganz (z. B. eine Nacht mit allen Schlafphasen).
 * `hits` zählt die Einträge, die den Tag sicher betreffen; 0 = der Datensatz sagt über den Tag nichts.
 */
export function trimToDay(v: unknown, day: string): { value: unknown; hits: number } {
  let hits = 0;
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 8) return x;
    if (Array.isArray(x)) {
      if (!x.some((e) => isObj(e))) return x;
      const kept: unknown[] = [];
      for (const e of x) {
        const t = isObj(e) ? touchesDay(e, day) : null;
        if (t === false) continue;
        if (t === true) { hits++; kept.push(e); } else kept.push(isObj(e) ? walk(e, depth + 1) : e);
      }
      return kept;
    }
    if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, e]) => [k, walk(e, depth + 1)]));
    return x;
  };
  const value = walk(v, 0);
  return { value, hits };
}

// ---------- Was nie in den Export darf ----------

/** Schlüssel mit Ortsangaben: Breite/Länge (auch Start/Ende), Routen, Polylinien, Orte, Karten */
const LOCATION_KEY = new RegExp(
  "^(?:(?:start|end|begin)_?)?(?:position_?)?(?:lat|lon|lng|long|latitude|longitude|lat_?lng|lat_?lon)$" +
    "|^(?:(?:start|end|begin)_?)?location(?:s|_?name)?$" +
    "|polyline|route|^geo|^gps|^coordinates?$|^positions?$|^map$|^latlngs?$",
  "i",
);
export const isLocationKey = (k: string) => LOCATION_KEY.test(k);
/** Profil der Person in Rohantworten (Garmin: ownerDisplayName, ownerFullName, ownerProfileImageUrl…). Gerätenamen
 *  (Googles dataSource.device.displayName) bleiben, die sagen, was gemessen hat. */
const PROFILE_KEY = /^owner(?:display|full)?_?name$|^(?:full|user)_?name$|^e?mail(?:_?address)?$|profile_?image|avatar|^photos?$/i;
export const isProfileKey = (k: string) => PROFILE_KEY.test(k);

/** Kopie ohne Ortsangaben (GPS-Routen, Startorte) und ohne Profil (Name, Profilbild): kommen nie in den Export */
export function stripPrivate<T>(v: T, depth = 0): T {
  if (depth > 40) return v;
  if (Array.isArray(v)) return v.map((x) => stripPrivate(x, depth + 1)) as T;
  if (isObj(v)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) if (!isLocationKey(k) && !isProfileKey(k)) out[k] = stripPrivate(x, depth + 1);
    return out as T;
  }
  return v;
}

// ---------- Google Health live (Referenz: developers.google.com/health/reference/rest, v4) ----------

/** Welches Zeitfeld der Filter nutzt: Tageswerte, Zeitspannen, Messpunkte, Schlaf (Aufwachen), Einheiten, ohne Filter */
export type ProbeKind = "daily" | "interval" | "sample" | "sleep" | "session" | "none";
export interface GoogleProbe {
  /** Kennung in Anfrage und Datei: „list:heart-rate“, „dailyRollUp:steps“ */
  id: string;
  /** Datentyp im Pfad users/me/dataTypes/{type} (kebab-case) */
  type: string;
  method: "list" | "dailyRollUp";
  kind: ProbeKind;
  /** Höchstens so viele Seiten (Standard 1); Workers Free erlaubt 50 Anfragen pro Aufruf */
  pages?: number;
  pageSize?: number;
  /** Nur in v4beta dokumentiert */
  beta?: boolean;
}
const L = (type: string, kind: ProbeKind, extra: Partial<GoogleProbe> = {}): GoogleProbe => ({ id: "list:" + type, type, method: "list", kind, ...extra });
const R = (type: string): GoogleProbe => ({ id: "dailyRollUp:" + type, type, method: "dailyRollUp", kind: "none" });

/**
 * Jede lesbare Datenart einzeln, mit unseren drei Rechten (Schlaf, Aktivität, Gesundheitswerte). Die Oberfläche ruft
 * jede Art in einem eigenen Aufruf ab (/api/export/google), damit das Limit von 50 Anfragen nie greift.
 */
export const GOOGLE_PROBES: GoogleProbe[] = [
  // Schlaf (Nacht, die an diesem Tag endet, und Nickerchen) und Einheiten, aus allen Quellen
  L("sleep", "sleep", { pageSize: 25 }),
  L("exercise", "session", { pageSize: 25 }),
  // Tageswerte
  L("daily-resting-heart-rate", "daily"),
  L("daily-heart-rate-variability", "daily"),
  L("daily-oxygen-saturation", "daily"),
  L("daily-respiratory-rate", "daily"),
  L("daily-sleep-temperature-derivations", "daily"),
  L("daily-heart-rate-zones", "daily"),
  L("daily-vo2-max", "daily"),
  // Tagessummen, wie Google sie rechnet
  R("steps"), R("distance"), R("floors"), R("total-calories"), R("active-energy-burned"), R("active-zone-minutes"),
  R("active-minutes"), R("time-in-heart-rate-zone"), R("calories-in-heart-rate-zone"), R("heart-rate"), R("sedentary-period"), R("altitude"),
  // Messpunkte über den Tag (Puls im Tagesverlauf usw.)
  L("heart-rate", "sample", { pageSize: 10000, pages: 2 }),
  L("heart-rate-variability", "sample", { pages: 2 }),
  L("oxygen-saturation", "sample", { pages: 2 }),
  L("respiratory-rate-sleep-summary", "sample"),
  L("vo2-max", "sample"),
  L("run-vo2-max", "sample"),
  L("weight", "sample"),
  L("body-fat", "sample"),
  L("blood-glucose", "sample"),
  L("core-body-temperature", "sample"),
  L("skin-temperature-sensors", "sample", { beta: true, pages: 2 }),
  // Größe ist kein Tageswert: die letzten Einträge
  L("height", "none", { pageSize: 5 }),
  // Zeitspannen über den Tag (Schritte je Minute usw.)
  L("steps", "interval", { pages: 2 }),
  L("distance", "interval", { pages: 2 }),
  L("active-energy-burned", "interval", { pages: 2 }),
  L("basal-energy-burned", "interval"),
  L("active-zone-minutes", "interval"),
  L("active-minutes", "interval"),
  L("activity-level", "interval"),
  L("sedentary-period", "interval"),
  L("time-in-heart-rate-zone", "interval"),
  L("altitude", "interval", { pages: 2 }),
  L("swim-lengths-data", "interval"),
];

/** Bewusst nicht abgefragt (steht so in der Datei) */
export const GOOGLE_NOT_QUERIED = [
  { arten: ["electrocardiogram", "irregular-rhythm-notification"], grund: "bräuchte die zusätzlichen Rechte ecg.readonly bzw. irn.readonly" },
  { arten: ["food", "food-measurement-unit", "hydration-log", "nutrition-log"], grund: "bräuchte das zusätzliche Recht nutrition.readonly" },
  { arten: ["menstrual-period", "ovulation-test", "symptoms", "moods"], grund: "laut Referenz nur schreibbar" },
];

export const snakeType = (t: string) => t.replace(/-/g, "_");
export const camelType = (t: string) => t.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * Filter für dataPoints.list über einen Tag in Ortszeit [Tag, Folgetag). Googles Doku ist bei den Namen uneinheitlich
 * (snake_case laut Hinweis, camelCase im Beispiel `dailyHeartRateVariability.date`), deshalb `naming`; die Unterfelder
 * bleiben snake_case wie im Abgleich (src/google/sync.ts). null = ohne Filter.
 */
export function probeFilter(p: GoogleProbe, day: string, naming: "s" | "c" = "s"): string | null {
  const next = nextDay(day);
  const t = naming === "c" ? camelType(p.type) : snakeType(p.type);
  const range = (field: string) => `${field} >= "${day}" AND ${field} < "${next}"`;
  switch (p.kind) {
    case "daily": return range(`${t}.date`);
    case "interval": case "session": return range(`${t}.interval.civil_start_time`);
    case "sample": return range(`${t}.sample_time.civil_time`);
    case "sleep": return range(`${t}.interval.civil_end_time`);
    default: return null;
  }
}
/** Lohnt ein zweiter Versuch mit der anderen Schreibweise? Nur bei Typen aus mehreren Wörtern mit Filter */
export const namingMatters = (p: GoogleProbe) => p.type.includes("-") && p.kind !== "none" && p.method === "list";

/** Anfrage für dataPoints:dailyRollUp über genau einen Tag (Ende ausschließlich) */
export function rollupBody(day: string) {
  const d = (s: string) => ({ date: { year: +s.slice(0, 4), month: +s.slice(5, 7), day: +s.slice(8, 10) } });
  return { range: { start: d(day), end: d(nextDay(day)) }, windowSizeDays: 1 };
}

/** nextPageToken aus einer Antwort, ohne sie ganz einzulesen (Puls über den Tag kann mehrere MB groß sein) */
export function pageTokenOf(text: string): string {
  const i = text.lastIndexOf('"nextPageToken"');
  if (i < 0) return "";
  return /^"nextPageToken"\s*:\s*"([^"\\]*)"/.exec(text.slice(i, i + 4096))?.[1] ?? "";
}

/** Eine HTTP-Anfrage; status 0 = Netzwerkfehler. Von außen hereingereicht, damit die Tests Google nachbauen können */
export type Call = (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string; retry: string | null }>;
export interface ProbeResult {
  ok: boolean;
  status: number;
  retry: string | null;
  versuche: Array<Record<string, unknown>>;
  /** Antworten unverändert als Text, je Seite eine */
  pages: string[];
  more: boolean;
  /** Schreibweise, die Google angenommen hat (nur bei Typen aus mehreren Wörtern) */
  naming: "s" | "c" | null;
  anfrage?: unknown;
}

/** Fehlerantwort von Google (klein, als JSON wenn möglich) */
const errorBody = (text: string): unknown => {
  try { return JSON.parse(text.slice(0, 20000)); } catch { return text.slice(0, 2000); }
};

/**
 * Eine Datenart für einen Tag abrufen: dailyRollUp mit einer Anfrage, list mit höchstens `pages` Seiten und bei einem
 * falschen Filternamen (HTTP 400) einem zweiten Versuch in der anderen Schreibweise. `first` = Schreibweise für den
 * ersten Versuch (gelernt im Abgleich bzw. zuletzt erfolgreich). Höchstens 4 Anfragen.
 */
export async function runProbe(p: GoogleProbe, day: string, io: { call: Call; base: string; token: string; first: "s" | "c" }): Promise<ProbeResult> {
  const auth = { Authorization: "Bearer " + io.token, Accept: "application/json" };
  const res: ProbeResult = { ok: false, status: 0, retry: null, versuche: [], pages: [], more: false, naming: null };
  if (p.method === "dailyRollUp") {
    const body = rollupBody(day);
    res.anfrage = body;
    const r = await io.call(`${io.base}/users/me/dataTypes/${p.type}/dataPoints:dailyRollUp`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    res.status = r.status; res.retry = r.retry;
    if (r.status === 200) res.pages.push(r.text);
    res.versuche.push(r.status === 200 ? { status: 200 } : { status: r.status, fehler: errorBody(r.text) });
  } else {
    const order: Array<"s" | "c"> = namingMatters(p) ? [io.first, io.first === "s" ? "c" : "s"] : ["s"];
    for (const n of order) {
      const filter = probeFilter(p, day, n);
      let tok = "";
      for (let i = 0; i < (p.pages || 1); i++) {
        const q = new URLSearchParams();
        if (filter) q.set("filter", filter);
        if (p.pageSize) q.set("pageSize", String(p.pageSize));
        if (tok) q.set("pageToken", tok);
        const qs = q.toString();
        const r = await io.call(`${io.base}/users/me/dataTypes/${p.type}/dataPoints${qs ? "?" + qs : ""}`, { headers: auth });
        res.status = r.status; res.retry = r.retry;
        if (r.status !== 200) { res.versuche.push({ filter, seite: i + 1, status: r.status, fehler: errorBody(r.text) }); break; }
        res.pages.push(r.text);
        tok = pageTokenOf(r.text);
        if (!tok) break;
      }
      if (res.pages.length) {
        res.versuche.push({ filter, status: 200 });
        if (namingMatters(p)) res.naming = n;
        res.more = !!tok;
        break;
      }
      // Nur ein falscher Filtername (HTTP 400) lohnt den Versuch mit der anderen Schreibweise
      if (res.status !== 400) break;
    }
  }
  res.ok = res.pages.length > 0;
  return res;
}

/**
 * Antwort einer Seite in die Ausgabe übernehmen. Einheiten (exercise, klein) werden eingelesen und ohne Ortsangaben
 * wieder ausgegeben; alles andere geht als Text unverändert durch, ohne es im Speicher aufzubauen (Puls: mehrere MB).
 */
export function embedPage(text: string, strip: boolean): string {
  const t = text.trim();
  if (strip) {
    try { return JSON.stringify(stripPrivate(JSON.parse(t))); } catch { /* unten als Text */ }
  } else if (t.startsWith("{") && t.endsWith("}")) return t;
  return JSON.stringify({ keinJson: t.slice(0, 20000) });
}

/** Ergebnis einer Datenart als JSON-Text für die Oberfläche: Kopf, Versuche, dann die Antworten unverändert */
export function probeJson(p: GoogleProbe, r: ProbeResult, abgerufen: string): string {
  const out: Record<string, unknown> = { id: p.id, type: p.type, method: p.method, abgerufen };
  if (r.anfrage) out.anfrage = r.anfrage;
  Object.assign(out, { ok: r.ok, status: r.ok ? 200 : r.status, versuche: r.versuche, seiten: r.pages.length, weitereSeiten: r.more });
  if (r.naming) out.benennung = r.naming;
  // Abbruch für die übrigen Arten: Zugang ungültig bzw. Google bittet um eine Pause (auch nach einer ersten guten Seite)
  if (r.status === 401) out.stop = "verbindung";
  if (r.status === 429) { out.stop = "pause"; out.warten = r.retry; }
  const strip = p.type === "exercise";
  return "{" + JSON.stringify(out).slice(1, -1) + ',"antworten":[' + r.pages.map((t) => embedPage(t, strip)).join(",") + "]}";
}
