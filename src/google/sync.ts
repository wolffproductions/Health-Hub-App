// Google-Health-Sync (Fitbit, Pixel Watch, Fitbit Air). Läuft im Cron um :20 und :50 (eigener Aufruf, damit das
// Workers-Limit von 50 Anfragen nicht mit Garmin, WHOOP & Co. geteilt wird). Pro Lauf höchstens 20 Anfragen:
//   1. die letzten Tage neu (ab dem letzten Erfolg minus 1 Tag, mind. 3, höchstens 28 Tage),
//   2. Historie rückwärts in 30-Tage-Fenstern bis BACKFILL_DAYS.
// Ein Fenster = Schlaf, Trainings, 5 Tageswerte, Gewicht, Körperfett, Schritte (je nach Menge 10–14 Anfragen).
// Ohne Webhooks: Googles Benachrichtigungen brauchen ein eigenes Cloud-Projekt mit Abonnenten-Endpunkt, das lohnt
// sich für eine Person nicht. Fitbit synchronisiert ohnehin in Abständen.
import type { Env } from "../env";
import { kvDelete, kvGetJson, kvPut } from "../util";
import { backfillDays, saveMetrics } from "../garmin/sync";
import { dailyRollUp, getAccess, list, RateLimited } from "./client";
import { DAILY, dataPoints, extractBody, extractDaily, extractSleep, extractSteps, normalizeExercise } from "./extract";

const RECENT_DAYS = 3, WINDOW_DAYS = 30, MAX_REQUESTS = 20, MAX_PAGES = 6;

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

interface Budget { left: number; skipped: string[] }
const camel = (t: string) => t.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const snake = (t: string) => t.replace(/-/g, "_");

/**
 * Wie listAll, aber robust gegen Googles uneinheitliche Filternamen: erst camelCase (wie im Doku-Beispiel
 * `dailyHeartRateVariability.date`), bei HTTP 400 snake_case. Scheitert beides, wird der Typ übersprungen
 * (in `skipped` vermerkt) statt den ganzen Abgleich abzubrechen.
 */
async function listTyped(token: string, type: string, filterFor: (field: string) => string, budget: Budget, extra: Record<string, string> = {}): Promise<unknown[] | null> {
  for (const field of [camel(type), snake(type)]) {
    try {
      return await listAll(token, type, filterFor(field), budget, extra);
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

export async function googleStep(env: Env): Promise<GoogleMeta> {
  const meta = await kvGetJson<GoogleMeta>(env, "googleMeta", {});
  if (meta.pauseUntil && Date.now() < meta.pauseUntil) return meta;
  meta.lastRun = new Date().toISOString();
  try {
    const token = await getAccess(env);
    const profile = await kvGetJson<{ tz?: string } | null>(env, "profile", null);
    const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
    const today = todayIn(tz), tomorrow = addDays(today, 1);
    const budget: Budget = { left: MAX_REQUESTS, skipped: [] };
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
      const to = meta.oldest, from = [addDays(to, -WINDOW_DAYS), cutoff].sort()[1];
      if (!(await syncWindow(env, token, from, to, budget, meta))) break;
      meta.oldest = from;
      if (from <= cutoff) meta.complete = true;
    }
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE source = 'google'").first<{ n: number }>();
    meta.count = c?.n ?? 0;
    // Übersprungene Datentypen zeigen, aber nicht als Fehler
    meta.lastError = budget.skipped.length ? "Nicht lesbar: " + [...new Set(budget.skipped)].join(", ") : null;
    meta.pauseUntil = null;
    await kvDelete(env, "googleExpired");
  } catch (e) {
    if (e instanceof RateLimited) meta.pauseUntil = Date.now() + e.wait * 1000;
    meta.lastError = String((e as Error).message || e).slice(0, 200);
  }
  await kvPut(env, "googleMeta", JSON.stringify(meta));
  return meta;
}
