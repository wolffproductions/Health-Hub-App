// Strava-Sync (#44): bei jedem Cron-Lauf (alle 30 Minuten) neue Einheiten seit der neuesten bekannten,
// dann die Historie rückwärts in Seiten zu 100. Höchstens 4 Anfragen pro Lauf, weit unter Stravas Limits
// (Standard: 100 Lese-Anfragen je 15 Minuten, 1.000 am Tag). Bittet Strava um eine Pause, wartet der Sync.
// Neue Einheiten kommen zusätzlich sofort über den Webhook (siehe index.ts).
import type { Env } from "../env";
import { kvGetJson, kvPut } from "../util";
import { backfillDays } from "../garmin/sync";
import { api, getAccess, lastUsage, RateLimited, type Usage } from "./client";
import { decodePolyline, normalizeStrava, stravaDetail } from "./extract";

const PER_PAGE = 100;
const MAX_REQUESTS = 4;
/** Details (Segmente, Bestleistungen, Runden) je Lauf, zusätzlich zu den Listen-Anfragen (#50) */
const MAX_DETAILS = 2;
/** Bei Version 1 einmalig die Einheiten der letzten 180 Tage für den Detailabruf vormerken */
const DETAIL_VERSION = 1;

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
    // laps_done = 0: Details (Segmente, Runden) noch abrufen. Beim Aktualisieren bleiben schon geholte Segmente erhalten.
    `INSERT INTO activities (source, external_id, day, type, data, payload, route, route_done, laps_done, updated_at)
     VALUES ('strava', ?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7)
     ON CONFLICT(source, external_id) DO UPDATE SET day = ?2, type = ?3, payload = ?5, route = ?6, updated_at = ?7,
       data = CASE WHEN json_extract(activities.data, '$.seg') IS NOT NULL
                   THEN json_set(?4, '$.seg', json_extract(activities.data, '$.seg'), '$.be', json_extract(activities.data, '$.be'))
                   ELSE ?4 END`,
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

/** Details einer Aktivität speichern: Runden (wenn noch keine da), Segmente und Bestleistungen in data */
export async function saveDetail(env: Env, id: string, a: unknown) {
  const d = stravaDetail(a as Record<string, unknown>);
  await env.DB.prepare(
    "UPDATE activities SET laps = CASE WHEN ?1 <> '[]' THEN ?1 ELSE laps END, laps_done = 1, " +
      "data = json_set(data, '$.seg', json(?2), '$.be', json(?3)) WHERE source = 'strava' AND external_id = ?4",
  ).bind(JSON.stringify(d.laps), JSON.stringify(d.seg), JSON.stringify(d.be), id).run();
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
    // 3. Details (#50): Segmente, Strava-Bestleistungen, Runden bzw. Kilometer-Splits, neueste zuerst
    if (Number(await kvGetJson<number>(env, "stravaDetailVersion", 0)) < DETAIL_VERSION) {
      await env.DB.prepare("UPDATE activities SET laps_done = 0 WHERE source = 'strava' AND day >= date('now', '-180 days')").run();
      await kvPut(env, "stravaDetailVersion", String(DETAIL_VERSION));
    }
    const { results: todo } = await env.DB.prepare("SELECT external_id FROM activities WHERE source = 'strava' AND laps_done = 0 AND json_extract(data, '$.hidden') IS NULL ORDER BY day DESC LIMIT ?")
      .bind(MAX_DETAILS).all<{ external_id: string }>();
    for (const { external_id: id } of todo) {
      const a = await api(token, `/activities/${id.slice(1)}`, { include_all_efforts: "true" });
      await saveDetail(env, id, a);
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
  const a = await api(token, `/activities/${ev.object_id}`, { include_all_efforts: "true" });
  if (a) { await saveStrava(env, [a]); await saveDetail(env, "s" + ev.object_id, a); }
}
