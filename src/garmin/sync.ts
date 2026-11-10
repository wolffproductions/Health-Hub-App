// Ein Synchronisationsschritt pro Aufruf (Cron alle 30 Min. oder Button in der App):
//   1. die neuesten Tage (spätestens alle 3 h)
//   2. ein 28-Tage-Stück fehlender Historie, bis BACKFILL_DAYS erreicht ist
//   3. .fit-Datei von bis zu 2 Aktivitäten: Runden (Läufe), Route und Puls-Histogramm (ganze Historie)
// So bleibt jeder Lauf weit unter dem Limit von 50 ausgehenden Anfragen.
import type { Env } from "../env";
import { addDays, kvDelete, kvGetJson, kvPut, localDate } from "../util";
import { api, BASE, getToken } from "./client";
import {
  extractDailySummaries,
  extractFitnessAge,
  extractHrv,
  extractSleep,
  extractWeight,
  fitParse,
  normalizeActivity,
  extractBodyBatteryCurves,
  unzipFirst,
  type MetricRow,
} from "./extract";

const CHUNK_DAYS = 28;
const RECENT_DAYS = 7;
const RECENT_EVERY_MS = 3 * 3600 * 1000;
const LAPS_PER_RUN = 2;
// Routen nur für die letzten 90 Tage nachladen; neue Aktivitäten bekommen ihre immer
// (früher ROUTE_DAYS = 90) Route und Puls-Histogramm jetzt für die ganze Historie bis BACKFILL_DAYS

export interface Meta {
  lastRun?: string;
  lastRecent?: string;
  backfillFrom?: string;
  oldest?: string;
  complete?: boolean;
  step?: string;
  lastError?: string | null;
  lapsPending?: number;
  routesPending?: number;
  lapsPauseUntil?: number | null;
  fitAgeDay?: string;
}

export interface Profile { tz: string; units: string }

const nowS = () => Math.floor(Date.now() / 1000);

// Werden Extraktoren in extract.ts geändert, diese Zahl erhöhen: Der nächste Sync wertet dann
// alle gespeicherten Rohdaten (raw_records) neu aus, ohne Garmin erneut abzufragen.
// 2: Puls im Schlaf aus averageSpO2HRSleep, SpO2 im Schlaf
// 3: Stress-Höchstwert, Zeit je Stressstufe, Body Battery geladen/verbraucht (Balance)
// 4: VO2max je Einheit · 5: Kalorien je Einheit (#17)
const EXTRACT_VERSION = 5;
const EXTRACTORS: Record<string, (json: unknown) => MetricRow[]> = {
  dailysummaries: extractDailySummaries,
  sleep: extractSleep,
  hrv: extractHrv,
  weight: extractWeight,
};

async function reextract(env: Env): Promise<boolean> {
  const done = Number(await kvGetJson<number>(env, "extractVersion", 1));
  if (done >= EXTRACT_VERSION) return false;
  const { results } = await env.DB.prepare("SELECT kind, payload FROM raw_records WHERE source = 'garmin'")
    .all<{ kind: string; payload: string }>();
  const rows: MetricRow[] = [];
  for (const r of results) {
    const fn = EXTRACTORS[r.kind];
    if (!fn) continue;
    try { rows.push(...fn(JSON.parse(r.payload))); } catch { /* einzelne kaputte Antwort überspringen */ }
  }
  await saveMetrics(env, "garmin", rows);
  // Version 4: VO2max je Einheit aus der gespeicherten Garmin-Antwort nachtragen (eine Abfrage für alle)
  if (done < 4) {
    await env.DB.prepare("UPDATE activities SET data = json_set(data, '$.vo2', json_extract(payload, '$.vO2MaxValue')) WHERE source = 'garmin' AND payload IS NOT NULL AND json_valid(payload)").run();
  }
  // Version 5: Kalorien je Einheit aus der gespeicherten Garmin-Antwort nachtragen
  if (done < 5) {
    await env.DB.prepare("UPDATE activities SET data = json_set(data, '$.kcal', json_extract(payload, '$.calories')) WHERE source = 'garmin' AND payload IS NOT NULL AND json_valid(payload)").run();
  }
  await kvPut(env, "extractVersion", String(EXTRACT_VERSION));
  return true;
}
export const backfillDays = (env: Env) => Math.max(28, Math.min(3650, Number(env.BACKFILL_DAYS) || 365));

async function saveRaw(env: Env, kind: string, from: string, to: string, payload: unknown) {
  if (payload == null) return;
  await env.DB.prepare(
    "INSERT INTO raw_records (source, kind, range_key, payload, fetched_at) VALUES ('garmin', ?1, ?2, ?3, ?4) " +
      "ON CONFLICT(source, kind, range_key) DO UPDATE SET payload = ?3, fetched_at = ?4",
  ).bind(kind, `${from}_${to}`, JSON.stringify(payload), nowS()).run();
}

export async function saveMetrics(env: Env, source: string, rows: MetricRow[]) {
  const stmt = env.DB.prepare(
    "INSERT INTO daily_metrics (day, metric, source, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(day, metric, source) DO UPDATE SET value = ?4, updated_at = ?5",
  );
  const ts = nowS();
  for (let i = 0; i < rows.length; i += 100) {
    await env.DB.batch(rows.slice(i, i + 100).map((r) => stmt.bind(r.day, r.metric, source, r.value, ts)));
  }
}

async function saveActivities(env: Env, list: unknown) {
  if (!Array.isArray(list) || !list.length) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO activities (source, external_id, day, type, data, payload, updated_at)
     VALUES ('garmin', ?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(source, external_id) DO UPDATE SET day = ?2, type = ?3, data = ?4, payload = ?5, updated_at = ?6`,
  );
  const ts = nowS();
  const rows = list.map((a) => [a, normalizeActivity(a)] as const).filter(([, n]) => n);
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(rows.slice(i, i + 50).map(([a, n]) => stmt.bind(n!.id, n!.date, n!.type, JSON.stringify(n), JSON.stringify(a), ts)));
  }
  return rows.length;
}

/** Body-Battery-Verlauf (ungetestet, darf scheitern): Rohantwort sichern, Kurven für die Oberfläche in kv */
async function fetchBodyBattery(env: Env, token: string, from: string, to: string) {
  const rep = await api(token, "/wellness-service/wellness/bodyBattery/reports/daily", { startDate: from, endDate: to });
  if (!rep) return;
  await saveRaw(env, "bbreport", from, to, rep);
  const curves = extractBodyBatteryCurves(rep);
  if (curves.length) await kvPut(env, "bbCurves", JSON.stringify({ at: new Date().toISOString(), curves }));
}

async function fetchRange(env: Env, token: string, from: string, to: string) {
  const [summaries, sleep, hrv] = await Promise.all([
    api(token, "/usersummary-service/v2/dailysummaries", { startDate: from, endDate: to }),
    api(token, "/sleep-service/sleep/dailySleepSummariesByDate", { startDate: from, endDate: to }),
    api(token, `/hrv-service/hrv/daily/${from}/${to}`),
  ]);
  await Promise.all([
    saveRaw(env, "dailysummaries", from, to, summaries),
    saveRaw(env, "sleep", from, to, sleep),
    saveRaw(env, "hrv", from, to, hrv),
  ]);
  await saveMetrics(env, "garmin", [...extractDailySummaries(summaries), ...extractSleep(sleep), ...extractHrv(hrv)]);

  // Gewicht: Endpunkt noch ungetestet, darf den Sync nie blockieren
  try {
    const weight = await api(token, `/weight-service/weight/range/${from}/${to}`, { includeAll: "true" });
    if (weight) {
      await saveRaw(env, "weight", from, to, weight);
      await saveMetrics(env, "garmin", extractWeight(weight));
    }
  } catch { /* ignorieren */ }

  for (let start = 0; start < 1000; start += 100) {
    const page = await api(token, "/activitylist-service/activities/search/activities", { start, limit: 100, startDate: from, endDate: to });
    await saveActivities(env, page);
    if (!Array.isArray(page) || page.length < 100) break;
  }
}

// Aktivitäten, deren .fit-Datei noch fehlt: Läufe ohne Runden oder jüngere Aktivitäten ohne Route
const FILES_PENDING =
  "FROM activities WHERE source = 'garmin' AND ((laps_done = 0 AND type LIKE '%running%') OR (route_done = 0 AND day >= ?))";

/** .fit-Datei für bis zu `max` Aktivitäten (neueste zuerst): Runden und Route. 'limit', wenn Garmin um eine Pause bittet. */
async function fetchFiles(env: Env, token: string, max: number, routeFrom: string): Promise<"limit" | void> {
  const { results } = await env.DB.prepare(`SELECT external_id, type, file_key ${FILES_PENDING} ORDER BY day DESC LIMIT ?`)
    .bind(routeFrom, max).all<{ external_id: string; type: string | null; file_key: string | null }>();
  for (const { external_id: id, type, file_key: stored } of results) {
    let parsed: ReturnType<typeof fitParse> = { laps: [], route: [], hist: [], streams: null };
    let fileKey: string | null = null;
    // Schon in R2 gespeichert? Dann ohne erneute Garmin-Anfrage neu auswerten
    if (stored && env.FILES) {
      try {
        const obj = await env.FILES.get(stored);
        if (obj) {
          parsed = fitParse(await unzipFirst(await obj.arrayBuffer()));
          await saveFileResult(env, id, type, parsed, null);
          continue;
        }
      } catch { /* dann wie gewohnt von Garmin laden */ }
    }
    try {
      const r = await fetch(BASE + `/download-service/files/activity/${id}`, {
        headers: { Authorization: "Bearer " + token, Accept: "application/zip, application/x-zip-compressed, application/octet-stream" },
      });
      if (r.status !== 404) {
        if (!r.ok) return "limit";
        const buf = await r.arrayBuffer();
        if (env.FILES) {
          fileKey = `garmin/activities/${id}.zip`;
          await env.FILES.put(fileKey, buf, { httpMetadata: { contentType: "application/zip" } });
        }
        parsed = fitParse(await unzipFirst(buf));
      }
    } catch { /* defekte Datei: als erledigt markieren */ }
    await saveFileResult(env, id, type, parsed, fileKey);
  }
}

/** Ergebnis der .fit-Auswertung speichern: Runden (nur Läufe), Route, Puls-Histogramm, Verläufe (#17) */
async function saveFileResult(env: Env, id: string, type: string | null, parsed: ReturnType<typeof fitParse>, fileKey: string | null) {
  const laps = type && type.includes("running") ? JSON.stringify(parsed.laps) : null;
  await env.DB.prepare(
    "UPDATE activities SET laps = COALESCE(?, laps), laps_done = 1, route = ?, hr_hist = ?, streams = ?, route_done = 1, file_key = COALESCE(?, file_key) " +
      "WHERE source = 'garmin' AND external_id = ?",
  ).bind(laps, JSON.stringify(parsed.route), JSON.stringify(parsed.hist), parsed.streams ? JSON.stringify(parsed.streams) : null, fileKey, id).run();
}

export async function syncStep(env: Env, force = false): Promise<Meta> {
  const meta = await kvGetJson<Meta>(env, "meta", {});
  meta.lastRun = new Date().toISOString();
  // Läuft auch ohne gültigen Garmin-Schlüssel, braucht nur die gespeicherten Rohdaten
  try { await reextract(env); } catch (e) { console.error("reextract", e); }
  try {
    const token = await getToken(env);

    let profile = await kvGetJson<Profile | null>(env, "profile", null);
    if (!profile) {
      const [p, zones] = await Promise.all([
        api(token, "/userprofile-service/userprofile/settings"),
        api(token, "/biometric-service/heartRateZones/v2"),
      ]);
      profile = { tz: p?.timeZone || env.TIMEZONE || "Europe/Berlin", units: p?.measurementSystem || "metric" };
      const garminZones = (Array.isArray(zones) ? zones : []).map((z: any) => ({
        sport: z.sport, max: z.maxHeartRateUsed, method: z.trainingMethod,
        floors: [z.zone1Floor, z.zone2Floor, z.zone3Floor, z.zone4Floor, z.zone5Floor],
      }));
      await kvPut(env, "profile", JSON.stringify(profile));
      await kvPut(env, "garminZones", JSON.stringify(garminZones));
    }

    const today = localDate(profile.tz);
    const oldest = addDays(today, -backfillDays(env) + 1);
    const steps: string[] = [];

    const recentDue = force || !meta.lastRecent || Date.now() - Date.parse(meta.lastRecent) > RECENT_EVERY_MS;
    if (recentDue || !meta.backfillFrom) {
      await fetchRange(env, token, addDays(today, -RECENT_DAYS + 1), today);
      meta.lastRecent = new Date().toISOString();
      meta.backfillFrom ||= addDays(today, -RECENT_DAYS + 1);
      steps.push("recent");
    }
    if (meta.backfillFrom > oldest) {
      const to = addDays(meta.backfillFrom, -1);
      const cand = addDays(to, -CHUNK_DAYS + 1);
      const from = cand < oldest ? oldest : cand;
      await fetchRange(env, token, from, to);
      meta.backfillFrom = from;
      steps.push("history");
    }
    // Heute bei jedem Durchgang (alle 30 Minuten) frisch: Tageswerte und Body-Battery-Verlauf (#79)
    try {
      if (!recentDue) {
        const sums = await api(token, "/usersummary-service/v2/dailysummaries", { startDate: today, endDate: today });
        await saveRaw(env, "dailysummaries", today, today, sums);
        await saveMetrics(env, "garmin", extractDailySummaries(sums));
      }
      await fetchBodyBattery(env, token, addDays(today, -1), today);
      steps.push("today");
    } catch { /* optional, darf den Sync nie blockieren */ }
    meta.step = steps.join("+") || "laps";
    meta.complete = meta.backfillFrom <= oldest;
    meta.oldest = meta.backfillFrom;
    meta.lastError = null;

    // Runden und Routen aus der .fit-Datei: bei "zu vielen Anfragen" 20 Minuten Pause
    const routeFrom = oldest;
    if (!meta.lapsPauseUntil || Date.now() > meta.lapsPauseUntil) {
      let limited = false;
      try { limited = (await fetchFiles(env, token, LAPS_PER_RUN, routeFrom)) === "limit"; } catch { /* optional */ }
      meta.lapsPauseUntil = limited ? Date.now() + 20 * 60000 : null;
    }
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM activities WHERE source = 'garmin' AND laps_done = 0 AND type LIKE '%running%'",
    ).first<{ n: number }>();
    meta.lapsPending = pending?.n ?? 0;
    const routes = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM activities WHERE source = 'garmin' AND route_done = 0 AND day >= ?",
    ).bind(routeFrom).first<{ n: number }>();
    meta.routesPending = routes?.n ?? 0;

    // Fitnessalter (#78): einmal am Tag, 1 Anfrage. Ungetestet, darf den Sync nie blockieren.
    if (meta.fitAgeDay !== today) {
      try {
        const fa = await api(token, `/fitnessage-service/fitnessage/v2/${today}`);
        await saveRaw(env, "fitnessage", today, today, fa);
        const x = extractFitnessAge(fa);
        if (x) {
          await kvPut(env, "fitAge", JSON.stringify({ at: new Date().toISOString(), ...x }));
          const d = x.day || today;
          const rows: MetricRow[] = [];
          if (x.fit != null) rows.push({ day: d, metric: "fitAge", value: x.fit });
          if (x.ach != null) rows.push({ day: d, metric: "fitAgeAch", value: x.ach });
          await saveMetrics(env, "garmin", rows);
        }
        meta.fitAgeDay = today;
      } catch { /* optional */ }
    }
  } catch (e) {
    meta.lastError = String((e as Error).message || e).slice(0, 200);
    if (/abgelehnt|401|403/.test(meta.lastError)) await kvDelete(env, "token");
  }
  await kvPut(env, "meta", JSON.stringify(meta));
  return meta;
}
