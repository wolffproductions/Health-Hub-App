// WHOOP-Sync (#119): bei jedem Cron-Lauf (alle 30 Minuten) die letzten 3 Tage neu (Schlaf, Recovery, Cycles,
// Workouts), dann die Historie rückwärts in 14-Tage-Fenstern bis BACKFILL_DAYS. Seitenweise über `next_token`.
// Höchstens 16 Anfragen pro Lauf: weit unter WHOOPs Limit (100 pro Minute) und dem Workers-Limit (50 pro Aufruf).
// Bittet WHOOP um eine Pause (HTTP 429), wartet der Sync. Webhooks (siehe index.ts) laden einzelne Nächte und
// Einheiten sofort; weil Meldungen doppelt kommen oder fehlen können, gleicht der Cron trotzdem regelmäßig ab.
import type { Env } from "../env";
import { kvGetJson, kvPut } from "../util";
import { backfillDays, saveMetrics, type Profile } from "../garmin/sync";
import { api, getAccess, RateLimited } from "./client";
import { extractCycles, extractRecoveries, extractSleeps, normalizeWorkout, records } from "./extract";

const RECENT_DAYS = 3, WINDOW_DAYS = 14, MAX_REQUESTS = 16, PAGE = 25, MAX_PAGES = 4;
const DAY_MS = 86400000;

export interface WhoopMeta {
  lastRun?: string;
  lastOk?: string;
  lastError?: string | null;
  /** ISO: Beginn des ältesten geladenen Fensters (Historie geht von hier rückwärts weiter) */
  oldest?: string;
  complete?: boolean;
  /** Ende der neuesten Nacht (ISO) */
  lastSleep?: string | null;
  count?: number;
  pauseUntil?: number | null;
  lastHook?: string | null;
}

const COLLECTIONS = {
  sleep: "/v2/activity/sleep",
  recovery: "/v2/recovery",
  cycle: "/v2/cycle",
  workout: "/v2/activity/workout",
} as const;
type Kind = keyof typeof COLLECTIONS;

async function tz(env: Env) {
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  return profile?.tz || env.TIMEZONE || "Europe/Berlin";
}

async function saveRaw(env: Env, kind: string, key: string, payload: unknown) {
  await env.DB.prepare(
    "INSERT INTO raw_records (source, kind, range_key, payload, fetched_at) VALUES ('whoop', ?1, ?2, ?3, ?4) " +
      "ON CONFLICT(source, kind, range_key) DO UPDATE SET payload = ?3, fetched_at = ?4",
  ).bind(kind, key, JSON.stringify(payload), Math.floor(Date.now() / 1000)).run();
}

/** Einheiten speichern (ohne Route, Runden und Verläufe: die liefert WHOOP nicht) */
export async function saveWorkouts(env: Env, list: unknown[], zone: string) {
  const stmt = env.DB.prepare(
    `INSERT INTO activities (source, external_id, day, type, data, payload, route_done, laps_done, updated_at)
     VALUES ('whoop', ?1, ?2, ?3, ?4, ?5, 1, 1, ?6)
     ON CONFLICT(source, external_id) DO UPDATE SET day = ?2, type = ?3, data = ?4, payload = ?5, updated_at = ?6`,
  );
  const ts = Math.floor(Date.now() / 1000), rows = [];
  for (const w of list as any[]) {
    const n = normalizeWorkout(w, zone);
    if (n) rows.push(stmt.bind(n.id, n.date, n.type, JSON.stringify(n), JSON.stringify(w), ts));
  }
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
}

/** Alles aus einem Zeitfenster speichern. Schlaf zuerst, damit die Recovery ihren Aufwachtag findet. */
export async function saveWindow(env: Env, got: Partial<Record<Kind, unknown[]>>, zone: string) {
  const sleeps = extractSleeps({ records: got.sleep || [] }, zone);
  await saveMetrics(env, "whoop", [
    ...sleeps.rows,
    ...extractRecoveries({ records: got.recovery || [] }, sleeps.dayOf, zone),
    ...extractCycles({ records: got.cycle || [] }, zone),
  ]);
  if (got.workout?.length) await saveWorkouts(env, got.workout, zone);
}

/** Ein Zeitfenster aller vier Sammlungen holen; zählt die Anfragen in `budget` */
async function fetchWindow(token: string, start: Date, end: Date, budget: { left: number }): Promise<Partial<Record<Kind, unknown[]>> | null> {
  const out: Partial<Record<Kind, unknown[]>> = {};
  for (const kind of Object.keys(COLLECTIONS) as Kind[]) {
    const list: unknown[] = [];
    let next: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (budget.left <= 0) return null; // reicht nicht mehr für das ganze Fenster: im nächsten Lauf weiter
      const params: Record<string, string | number> = { limit: PAGE, start: start.toISOString(), end: end.toISOString() };
      if (next) params.nextToken = next;
      const body = await api(token, COLLECTIONS[kind], params);
      budget.left--;
      list.push(...records(body));
      next = typeof body?.next_token === "string" && body.next_token ? body.next_token : null;
      if (!next) break;
    }
    out[kind] = list;
  }
  return out;
}

export async function whoopStep(env: Env): Promise<WhoopMeta> {
  const meta = await kvGetJson<WhoopMeta>(env, "whoopMeta", {});
  if (meta.pauseUntil && Date.now() < meta.pauseUntil) return meta;
  meta.lastRun = new Date().toISOString();
  try {
    const token = await getAccess(env);
    const zone = await tz(env);
    const budget = { left: MAX_REQUESTS };
    const now = new Date();
    // 1. Die letzten Tage neu (Nächte und Recovery werden teils noch nachträglich berechnet). War die App länger
    //    nicht dran, ab dem letzten erfolgreichen Abruf (höchstens 28 Tage), damit keine Lücke entsteht.
    const since = meta.lastOk ? Date.parse(meta.lastOk) - DAY_MS : now.getTime();
    const recentStart = new Date(Math.max(now.getTime() - 28 * DAY_MS, Math.min(now.getTime() - RECENT_DAYS * DAY_MS, since)));
    const recent = await fetchWindow(token, recentStart, now, budget);
    if (recent) {
      // Rohdaten je Kalendertag des Abrufs, damit auch die jüngsten Tage später neu ausgewertet werden können
      await saveRaw(env, "recent", now.toISOString().slice(0, 10), recent);
      await saveWindow(env, recent, zone);
      for (const s of (recent.sleep || []) as any[]) {
        if (s?.nap !== true && typeof s?.end === "string" && (!meta.lastSleep || s.end > meta.lastSleep)) meta.lastSleep = s.end;
      }
    }
    // 2. Historie rückwärts in 14-Tage-Fenstern
    const cutoff = now.getTime() - backfillDays(env) * DAY_MS;
    while (!meta.complete && budget.left > 0) {
      const end = new Date(meta.oldest ? Date.parse(meta.oldest) : recentStart.getTime());
      const start = new Date(Math.max(cutoff, end.getTime() - WINDOW_DAYS * DAY_MS));
      const got = await fetchWindow(token, start, end, budget);
      if (!got) break;
      await saveRaw(env, "window", start.toISOString().slice(0, 10), got);
      await saveWindow(env, got, zone);
      meta.oldest = start.toISOString();
      if (start.getTime() <= cutoff) meta.complete = true;
    }
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE source = 'whoop'").first<{ n: number }>();
    meta.count = c?.n ?? 0;
    meta.lastOk = new Date().toISOString();
    meta.lastError = null;
    meta.pauseUntil = null;
  } catch (e) {
    if (e instanceof RateLimited) meta.pauseUntil = Date.now() + e.wait * 1000;
    meta.lastError = String((e as Error).message || e).slice(0, 200);
  }
  await kvPut(env, "whoopMeta", JSON.stringify(meta));
  return meta;
}

/** Maximalpuls aus WHOOPs Körperdaten (für Zonen und Prognose, wenn Garmin keinen liefert); einmal am Tag */
export async function whoopBodyDaily(env: Env) {
  const body = await kvGetJson<{ at?: string } | null>(env, "whoopBody", null);
  if (body?.at && Date.now() - Date.parse(body.at) < DAY_MS) return;
  const token = await getAccess(env);
  const b = await api(token, "/v2/user/measurement/body");
  if (b) await kvPut(env, "whoopBody", JSON.stringify({ at: new Date().toISOString(), maxHr: typeof b.max_heart_rate === "number" ? b.max_heart_rate : null }));
}

/**
 * Webhook: nur die gemeldete Nacht bzw. Einheit nachladen. Bei Recovery und Schlaf ist `id` die Schlaf-ID (v2);
 * dazu Recovery und Cycle derselben Nacht. Gelöschte Einheiten werden ausgeblendet, nicht entfernt (Historie bleibt).
 */
export async function whoopEvent(env: Env, ev: { type?: string; id?: string }) {
  const type = String(ev.type || ""), id = String(ev.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const meta = await kvGetJson<WhoopMeta>(env, "whoopMeta", {});
  meta.lastHook = new Date().toISOString();
  await kvPut(env, "whoopMeta", JSON.stringify(meta));
  if (type === "workout.deleted") {
    await env.DB.prepare("UPDATE activities SET data = json_set(data, '$.hidden', 1) WHERE source = 'whoop' AND external_id = ?").bind("w" + id).run();
    return;
  }
  const token = await getAccess(env);
  const zone = await tz(env);
  if (type === "workout.updated") {
    const w = await api(token, "/v2/activity/workout/" + id);
    if (w) await saveWorkouts(env, [w], zone);
    return;
  }
  if (type === "sleep.updated" || type === "recovery.updated") {
    const s = await api(token, "/v2/activity/sleep/" + id);
    if (!s) return;
    const cycleId = s.cycle_id;
    const [rec, cyc] = cycleId != null
      ? await Promise.all([api(token, `/v2/cycle/${encodeURIComponent(cycleId)}/recovery`), api(token, `/v2/cycle/${encodeURIComponent(cycleId)}`)])
      : [null, null];
    await saveWindow(env, { sleep: [s], recovery: rec ? [rec] : [], cycle: cyc ? [cyc] : [] }, zone);
  }
  // sleep.deleted / recovery.deleted: Werte bleiben (Historie wird nie gelöscht); der nächste Abgleich überschreibt geänderte Nächte
}
