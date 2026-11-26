// Google-Health-Sync (Fitbit, Pixel Watch, Fitbit Air). Läuft im Cron um :20 und :50 (eigener Aufruf, damit das
// Workers-Limit von 50 Anfragen nicht mit Garmin, WHOOP & Co. geteilt wird). Pro Lauf höchstens 20 Anfragen:
//   1. die letzten Tage neu (ab dem letzten Erfolg minus 1 Tag, mind. 3, höchstens 28 Tage),
//   2. Historie rückwärts in 14-Tage-Fenstern bis BACKFILL_DAYS (passt ein Fenster nicht ins Kontingent, wird es halbiert).
// Ein Fenster = Schlaf, Trainings, 5 Tageswerte, Gewicht, Körperfett, Schritte (etwa 10–12 Anfragen, sobald die
// Filternamen je Typ gelernt sind).
// Ohne Webhooks: Googles Benachrichtigungen brauchen ein eigenes Cloud-Projekt mit Abonnenten-Endpunkt, das lohnt
// sich für eine Person nicht. Fitbit synchronisiert ohnehin in Abständen.
import type { Env } from "../env";
import { kvDelete, kvGetJson, kvPut } from "../util";
import { backfillDays, saveMetrics } from "../garmin/sync";
import { dailyRollUp, getAccess, list, RateLimited } from "./client";
import { DAILY, dataPoints, extractBody, extractDaily, extractSleep, extractSteps, normalizeExercise } from "./extract";

// Eigener Cron-Aufruf: 30 von 50 ausgehenden Anfragen, Rest für Token-Erneuerung und Reserve
const RECENT_DAYS = 3, WINDOW_DAYS = 14, MAX_REQUESTS = 30, MAX_PAGES = 6;

export interface GoogleMeta {
  lastRun?: string;
  lastOk?: string;
  lastError?: string | null;
  /** Ältester geladener Tag (JJJJ-MM-TT); Historie geht von hier rückwärts weiter */
  oldest?: string;
  complete?: boolean;
  lastSleep?: string | null;
  count?: number;
  pauseUntil?: number | null;
  /** Gelernter Filtername je Datentyp: s = snake_case, c = camelCase (spart die doppelte Anfrage) */
  fields?: Record<string, "s" | "c">;
  /** Aktuelle Fenstergröße der Historie in Tagen (halbiert, wenn ein Fenster nicht ins Kontingent passt) */
  win?: number;
}

const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

async function saveRaw(env: Env, kind: string, key: string, payload: unknown) {
  await env.DB.prepare(
    "INSERT INTO raw_records (source, kind, range_key, payload, fetched_at) VALUES ('google', ?1, ?2, ?3, ?4) " +
      "ON CONFLICT(source, kind, range_key) DO UPDATE SET payload = ?3, fetched_at = ?4",
  ).bind(kind, key, JSON.stringify(payload), Math.floor(Date.now() / 1000)).run();
}

export async function saveExercises(env: Env, points: unknown[]) {
  const stmt = env.DB.prepare(
    `INSERT INTO activities (source, external_id, day, type, data, payload, route_done, laps_done, updated_at)
     VALUES ('google', ?1, ?2, ?3, ?4, ?5, 1, 1, ?6)
     ON CONFLICT(source, external_id) DO UPDATE SET day = ?2, type = ?3, data = ?4, payload = ?5, updated_at = ?6`,
  );
  const ts = Math.floor(Date.now() / 1000), rows = [];
  for (const p of points as any[]) {
    const a = normalizeExercise(p);
    if (a) rows.push(stmt.bind(a.id, a.date, a.type, JSON.stringify(a), JSON.stringify(p), ts));
  }
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
}

interface Budget { left: number; skipped: string[]; fields: Record<string, "s" | "c"> }
const camel = (t: string) => t.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const snake = (t: string) => t.replace(/-/g, "_");

/**
 * Wie listAll, aber robust gegen Googles uneinheitliche Filternamen: erst der zuletzt erfolgreiche Name, sonst
 * snake_case (laut Hinweis in der Doku), bei HTTP 400 camelCase (wie im Doku-Beispiel `dailyHeartRateVariability.date`).
 * Der passende Name wird gemerkt (`budget.fields`). Scheitert beides, wird der Typ übersprungen (in `skipped`
 * vermerkt) statt den ganzen Abgleich abzubrechen.
 */
async function listTyped(token: string, type: string, filterFor: (field: string) => string, budget: Budget, extra: Record<string, string> = {}): Promise<unknown[] | null> {
  const order: Array<"s" | "c"> = budget.fields[type] === "c" ? ["c", "s"] : ["s", "c"];
  for (const k of order) {
    try {
      const r = await listAll(token, type, filterFor(k === "s" ? snake(type) : camel(type)), budget, extra);
      if (r) budget.fields[type] = k;
      return r;
    } catch (e) {
      if ((e as any).status !== 400) throw e;
    }
  }
  budget.skipped.push(type);
  return [];
}

/** Alle Seiten eines list-Abrufs; null, wenn das Kontingent nicht reicht */
async function listAll(token: string, type: string, filter: string, budget: Budget, extra: Record<string, string> = {}): Promise<unknown[] | null> {
  const out: unknown[] = [];
  let pageToken = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    if (budget.left <= 0) return null;
    const params: Record<string, string> = { filter, ...extra };
    if (type === "sleep" || type === "exercise") params.pageSize = "25";
    if (pageToken) params.pageToken = pageToken;
    budget.left--; // vor dem Abruf zählen, auch gescheiterte Anfragen gehen aufs Workers-Limit
    const body = await list(token, type, params);
    out.push(...dataPoints(body));
    pageToken = typeof body?.nextPageToken === "string" ? body.nextPageToken : "";
    if (!pageToken) break;
  }
  return out;
}

/** Ein Zeitfenster [from, to) in Ortszeit holen und speichern. false = Kontingent aufgebraucht, im nächsten Lauf weiter. */
async function syncWindow(env: Env, token: string, from: string, to: string, budget: Budget, meta: GoogleMeta): Promise<boolean> {
  const got: Record<string, unknown> = {};
  // Schlaf: nach Aufwachzeit (zählt zum Tag des Aufwachens); Nickerchen filtert extract
  const sleep = await listAll(token, "sleep", `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${to}"`, budget);
  if (!sleep) return false;
  got.sleep = sleep;
  // Trainings nur von Google-Geräten: Garmin-Einheiten, die per Health Connect bei Google landen, kommen schon direkt
  const ex = await listAll(token, "exercise", `exercise.interval.civil_start_time >= "${from}" AND exercise.interval.civil_start_time < "${to}"`, budget,
    { dataSourceFamily: "users/me/dataSourceFamilies/google-wearables" });
  if (!ex) return false;
  got.exercise = ex;
  const rows = [...extractSleep({ dataPoints: sleep })];
  for (const type of Object.keys(DAILY)) {
    const pts = await listTyped(token, type, (f) => `${f}.date >= "${from}" AND ${f}.date < "${to}"`, budget,
      { dataSourceFamily: "users/me/dataSourceFamilies/google-wearables" });
    if (!pts) return false;
    got[type] = pts;
    rows.push(...extractDaily(type, { dataPoints: pts }));
  }
  // Gewicht und Körperfett aus allen Quellen (Fitbit-Waage, manuell eingetragen)
  for (const type of ["weight", "body-fat"]) {
    const pts = await listTyped(token, type, (f) => `${f}.sample_time.civil_time >= "${from}" AND ${f}.sample_time.civil_time < "${to}"`, budget);
    if (!pts) return false;
    got[type] = pts;
    rows.push(...extractBody({ dataPoints: pts }));
  }
  if (budget.left <= 0) return false;
  // dailyRollUp: höchstens 90 Tage, Fenster sind kürzer. Scheitert es (z. B. Format), ohne Schritte weiter.
  budget.left--;
  const steps = await dailyRollUp(token, "steps", from, to, "google-wearables").catch((e) => {
    if ((e as any).status !== 400) throw e;
    budget.skipped.push("steps");
    return null;
  });
  got.steps = steps;
  rows.push(...extractSteps(steps));

  await saveRaw(env, "window", from + "_" + to, got);
  await saveMetrics(env, "google", rows);
  if (ex.length) await saveExercises(env, ex);
  for (const p of sleep as any[]) {
    const end = p?.sleep?.interval?.endTime;
    if (p?.sleep?.metadata?.nap !== true && typeof end === "string" && (!meta.lastSleep || end > meta.lastSleep)) meta.lastSleep = end;
  }
  return true;
}

// ---------- Gespeicherte Fenster neu auswerten ----------
// Version 2 (Feedback #8): Schlaf und Trainings ohne civil-Felder (nur Weltzeit + Zeitunterschied) wurden verworfen.
// Die Rohantworten liegen in raw_records (kind 'window'), also ohne neuen Abruf bei Google nachholen: 4 Fenster je Lauf,
// damit ein Aufruf klein bleibt. Stand in kv `googleExtract` { v, after = rowid }.
const GOOGLE_EXTRACT_VERSION = 2, REEXTRACT_PER_RUN = 4;

/** Alle Tageswerte aus einem gespeicherten Fenster (gleiche Teile wie syncWindow) */
export function extractWindow(got: Record<string, unknown>): ReturnType<typeof extractSleep> {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const rows = [...extractSleep({ dataPoints: arr(got.sleep) })];
  for (const type of Object.keys(DAILY)) rows.push(...extractDaily(type, { dataPoints: arr(got[type]) }));
  for (const type of ["weight", "body-fat"]) rows.push(...extractBody({ dataPoints: arr(got[type]) }));
  rows.push(...extractSteps(got.steps));
  return rows;
}

async function reextract(env: Env) {
  const st = await kvGetJson<{ v?: number; after?: number }>(env, "googleExtract", {});
  if ((st.v || 1) >= GOOGLE_EXTRACT_VERSION) return;
  const { results } = await env.DB.prepare("SELECT rowid AS id, payload FROM raw_records WHERE source = 'google' AND kind = 'window' AND rowid > ?1 ORDER BY rowid LIMIT ?2")
    .bind(st.after || 0, REEXTRACT_PER_RUN).all<{ id: number; payload: string }>();
  for (const r of results) {
    try {
      const got = JSON.parse(r.payload) as Record<string, unknown>;
      await saveMetrics(env, "google", extractWindow(got));
      if (Array.isArray(got.exercise) && got.exercise.length) await saveExercises(env, got.exercise);
    } catch { /* einzelnes kaputtes Fenster überspringen */ }
    st.after = r.id;
  }
  if (results.length < REEXTRACT_PER_RUN) { st.v = GOOGLE_EXTRACT_VERSION; st.after = 0; }
  await kvPut(env, "googleExtract", JSON.stringify(st));
}

export async function googleStep(env: Env): Promise<GoogleMeta> {
  // Ohne Google-Abruf, darf scheitern: ältere Fenster mit der neuen Auswertung nachrechnen
  await reextract(env).catch((e) => console.error("google reextract", e));
  const meta = await kvGetJson<GoogleMeta>(env, "googleMeta", {});
  if (meta.pauseUntil && Date.now() < meta.pauseUntil) return meta;
  meta.lastRun = new Date().toISOString();
  try {
    const token = await getAccess(env);
    const profile = await kvGetJson<{ tz?: string } | null>(env, "profile", null);
    const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
    const today = todayIn(tz), tomorrow = addDays(today, 1);
    const budget: Budget = { left: MAX_REQUESTS, skipped: [], fields: { ...(meta.fields || {}) } };
    // Während die Historie lädt, die letzten Tage nur alle 2 Stunden neu, sonst bei jedem Lauf
    const recentDue = meta.complete || !meta.lastOk || Date.now() - Date.parse(meta.lastOk) > 2 * 3600000 || !meta.oldest;
    if (recentDue) {
      // Ab dem letzten Erfolg minus 1 Tag, mindestens die letzten 3 Tage, höchstens 28 Tage zurück
      const since = meta.lastOk ? addDays(meta.lastOk.slice(0, 10), -1) : today;
      const start = since < addDays(today, -RECENT_DAYS) ? since : addDays(today, -RECENT_DAYS);
      const from = start < addDays(today, -28) ? addDays(today, -28) : start;
      if (await syncWindow(env, token, from, tomorrow, budget, meta)) {
        meta.oldest ??= from;
        meta.lastOk = new Date().toISOString();
      }
    }
    // Historie rückwärts
    const cutoff = addDays(today, -backfillDays(env));
    while (!meta.complete && meta.oldest && budget.left >= 10) {
      const win = Math.max(1, Math.min(WINDOW_DAYS, meta.win || WINDOW_DAYS)), startLeft = budget.left;
      const to = meta.oldest, from = [addDays(to, -win), cutoff].sort()[1];
      if (!(await syncWindow(env, token, from, to, budget, meta))) {
        // Passt das Fenster nicht einmal mit vollem Kontingent, beim nächsten Mal kleiner (sonst ewig dasselbe Fenster)
        if (startLeft >= MAX_REQUESTS - 1) meta.win = Math.max(1, Math.floor(win / 2));
        break;
      }
      meta.oldest = from;
      if (from <= cutoff) meta.complete = true;
    }
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE source = 'google'").first<{ n: number }>();
    meta.count = c?.n ?? 0;
    // Übersprungene Datentypen zeigen, aber nicht als Fehler
    meta.lastError = budget.skipped.length ? "Nicht lesbar: " + [...new Set(budget.skipped)].join(", ") : null;
    meta.pauseUntil = null;
    meta.fields = budget.fields;
    await kvDelete(env, "googleExpired");
  } catch (e) {
    if (e instanceof RateLimited) meta.pauseUntil = Date.now() + e.wait * 1000;
    meta.lastError = String((e as Error).message || e).slice(0, 200);
  }
  await kvPut(env, "googleMeta", JSON.stringify(meta));
  return meta;
}
