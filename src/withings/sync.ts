// Withings-Sync: bei jedem Cron-Lauf (alle 30 Minuten) neue oder geänderte Messungen seit dem
// letzten Abruf (`lastupdate`). Beim ersten Mal kommt die ganze Historie, seitenweise.
// Wenige Anfragen pro Lauf, weit unter dem Limit von 50.
import type { Env } from "../env";
import { kvGetJson, kvPut } from "../util";
import { saveMetrics, type Profile } from "../garmin/sync";
import { getAccess, post } from "./client";
import { extractMeasures, MEASTYPES } from "./extract";

const MAX_PAGES = 8;

export interface WithingsMeta {
  lastRun?: string;
  lastOk?: string;
  lastError?: string | null;
  /** Unix-Sekunden: Withings' updatetime des letzten vollständigen Abrufs */
  lastupdate?: number;
  /** Fortsetzung, wenn die Historie mehr Seiten hatte als ein Lauf schafft */
  offset?: number | null;
  /** Zeitpunkt der neuesten Messung (Unix-Sekunden) */
  lastMeas?: number | null;
}

export async function withingsStep(env: Env): Promise<WithingsMeta> {
  const meta = await kvGetJson<WithingsMeta>(env, "withingsMeta", {});
  meta.lastRun = new Date().toISOString();
  try {
    const token = await getAccess(env);
    const profile = await kvGetJson<Profile | null>(env, "profile", null);
    const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
    let offset = meta.offset ?? null;
    let updatetime: number | null = null;
    let more = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const form: Record<string, string> = {
        action: "getmeas",
        meastypes: Object.keys(MEASTYPES).join(","),
        category: "1",
        lastupdate: String(meta.lastupdate ?? 0),
      };
      if (offset) form.offset = String(offset);
      const body = await post("/measure", form, token);
      updatetime ??= typeof body?.updatetime === "number" ? body.updatetime : null;
      await env.DB.prepare(
        "INSERT INTO raw_records (source, kind, range_key, payload, fetched_at) VALUES ('withings', 'getmeas', ?1, ?2, ?3) " +
          "ON CONFLICT(source, kind, range_key) DO UPDATE SET payload = ?2, fetched_at = ?3",
      ).bind(`${meta.lastupdate ?? 0}_${offset ?? 0}`, JSON.stringify(body), Math.floor(Date.now() / 1000)).run();
      await saveMetrics(env, "withings", extractMeasures(body, tz));
      for (const g of Array.isArray(body?.measuregrps) ? body.measuregrps : []) {
        if (typeof g?.date === "number" && g.date > (meta.lastMeas ?? 0)) meta.lastMeas = g.date;
      }
      more = !!body?.more && !!body?.offset;
      offset = more ? Number(body.offset) : null;
      if (!more) break;
    }
    // Erst wenn alle Seiten da sind, gilt der neue Stand; sonst geht es im nächsten Lauf weiter
    meta.offset = more ? offset : null;
    if (!more && updatetime) meta.lastupdate = updatetime;
    meta.lastOk = new Date().toISOString();
    meta.lastError = null;
  } catch (e) {
    meta.lastError = String((e as Error).message || e).slice(0, 200);
  }
  await kvPut(env, "withingsMeta", JSON.stringify(meta));
  return meta;
}
