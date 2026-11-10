// Strava-Sync (#44): bei jedem Cron-Lauf (alle 30 Minuten) neue Einheiten seit der neuesten bekannten,
// dann die Historie rückwärts in Seiten zu 100. Höchstens 4 Anfragen pro Lauf, weit unter Stravas Limits
// (Standard: 100 Lese-Anfragen je 15 Minuten, 1.000 am Tag). Bittet Strava um eine Pause, wartet der Sync.
// Neue Einheiten kommen zusätzlich sofort über den Webhook (siehe index.ts).
import type { Env } from "../env";
import { kvGetJson, kvPut } from "../util";
import { backfillDays } from "../garmin/sync";
import { api, getAccess, lastUsage, RateLimited, type Usage } from "./client";
import { decodePolyline, normalizeStrava } from "./extract";

const PER_PAGE = 100;
const MAX_REQUESTS = 4;

export interface StravaMeta {
  lastRun?: string;
  lastOk?: string;
  lastError?: string | null;
  /** Unix-Sekunden: Start der neuesten bekannten Einheit */
  newest?: number;
  /** Unix-Sekunden: ältester geladener Start (Historie geht von hier rückwärts weiter) */
  oldest?: number;
  complete?: boolean;
  count?: number;
  pauseUntil?: number | null;
  usage?: Usage | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

/** Einheiten speichern; Route aus der vereinfachten Strava-Linie. Liefert die Start-Zeitpunkte. */
export async function saveStrava(env: Env, list: unknown): Promise<number[]> {
  if (!Array.isArray(list) || !list.length) return [];
  const stmt = env.DB.prepare(
    `INSERT INTO activities (source, external_id, day, type, data, payload, route, route_done, laps_done, updated_at)
     VALUES ('strava', ?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7)
     ON CONFLICT(source, external_id) DO UPDATE SET day = ?2, type = ?3, data = ?4, payload = ?5, route = ?6, updated_at = ?7`,
  );
  const ts = nowS(), starts: number[] = [], rows = [];
  for (const a of list as any[]) {
    const n = normalizeStrava(a);
    if (!n) continue;
    const route = decodePolyline(a.map?.summary_polyline || a.map?.polyline);
    rows.push(stmt.bind(n.id, n.date, n.type, JSON.stringify(n), JSON.stringify(a), JSON.stringify(route), ts));
    const t = Date.parse(a.start_date);
    if (isFinite(t)) starts.push(Math.floor(t / 1000));
  }
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
  return starts;
}

export async function stravaStep(env: Env): Promise<StravaMeta> {
  const meta = await kvGetJson<StravaMeta>(env, "stravaMeta", {});
  if (meta.pauseUntil && Date.now() < meta.pauseUntil) return meta;
  meta.lastRun = new Date().toISOString();
  let requests = 0;
  try {
    const token = await getAccess(env);
    // 1. Neue Einheiten seit der neuesten bekannten (eine Stunde Überlappung für nachträgliche Uploads)
    if (meta.newest) {
      for (let page = 1; requests < 2; page++) {
        const list = await api(token, "/athlete/activities", { after: meta.newest - 3600, per_page: PER_PAGE, page });
        requests++;
        const starts = await saveStrava(env, list);
        if (starts.length) meta.newest = Math.max(meta.newest, ...starts);
        if (!Array.isArray(list) || list.length < PER_PAGE) break;
      }
    }
    // 2. Historie rückwärts bis BACKFILL_DAYS (wie bei Garmin)
    const cutoff = nowS() - backfillDays(env) * 86400;
    while (!meta.complete && requests < MAX_REQUESTS) {
      const list = await api(token, "/athlete/activities", { before: meta.oldest ?? nowS() + 3600, per_page: PER_PAGE, page: 1 });
      requests++;
      const starts = await saveStrava(env, list);
      if (starts.length) {
        meta.newest = Math.max(meta.newest ?? 0, ...starts);
        meta.oldest = Math.min(meta.oldest ?? Infinity, ...starts);
      }
      if (!Array.isArray(list) || list.length < PER_PAGE || (meta.oldest ?? 0) < cutoff) meta.complete = true;
    }
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE source = 'strava'").first<{ n: number }>();
    meta.count = c?.n ?? 0;
    meta.lastOk = new Date().toISOString();
    meta.lastError = null;
    meta.pauseUntil = null;
  } catch (e) {
    if (e instanceof RateLimited) {
      // 15-Minuten-Limit: bis zum nächsten Viertelstunden-Fenster; Tageslimit: bis Mitternacht UTC
      const now = new Date();
      meta.pauseUntil = e.daily ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) : Math.ceil(Date.now() / 900000) * 900000 + 60000;
    }
    meta.lastError = String((e as Error).message || e).slice(0, 200);
  }
  meta.usage = lastUsage ?? meta.usage ?? null;
  await kvPut(env, "stravaMeta", JSON.stringify(meta));
  return meta;
}

/** Webhook: eine einzelne Einheit neu laden (Detailansicht enthält auch Kalorien) oder ausblenden.
 *  Gelöschte Einheiten werden nur ausgeblendet, nicht entfernt (Historie wird nie gelöscht). */
export async function stravaEvent(env: Env, ev: { object_type?: string; aspect_type?: string; object_id?: number }) {
  if (ev.object_type !== "activity" || ev.object_id == null) return;
  if (ev.aspect_type === "delete") {
    await env.DB.prepare("UPDATE activities SET data = json_set(data, '$.hidden', 1) WHERE source = 'strava' AND external_id = ?").bind("s" + ev.object_id).run();
    return;
  }
  const token = await getAccess(env);
  const a = await api(token, `/activities/${ev.object_id}`);
  if (a) await saveStrava(env, [a]);
}
