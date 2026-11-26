// Tag exportieren (Konto → Datenquellen → „Tag exportieren“). Die Person löst den Export selbst aus und verschickt die
// Datei selbst; Daten verlassen die Instanz nur über ihr eigenes Gerät.
//   GET /api/export/tag?day=JJJJ-MM-TT     alles Gespeicherte zu einem Tag (nur D1, keine Anfrage nach außen)
//   GET /api/export/google?day=…&id=…      eine Google-Health-Datenart live (je Art ein eigener Aufruf: Workers Free
//                                          erlaubt 50 Anfragen pro Aufruf, eine Art braucht höchstens 4)
// Die Oberfläche (src/ui/konto.js.txt, „dx…“) setzt daraus die Datei zusammen.
// Nie im Export: Schlüssel, Tokens, Passwörter, kv außer harmlosen Statusangaben, Stimmung, Freunde, Profil und Bild,
// GPS-Routen und Ortsangaben, Strava und WHOOP (deren Bedingungen). Reine Hilfen: src/export-tag.ts.
import type { Env } from "./env";
import { buildData } from "./data";
import { DEFAULT_SRC_CFG, type SrcCfg } from "./quellen";
import { VERSION } from "./version";
import { isDay, json, kvGet, kvGetJson, localDate, respond } from "./util";
import * as google from "./google/client";
import type { GoogleMeta } from "./google/sync";
import { connected as withingsConnected } from "./withings/client";
import * as strava from "./strava/client";
import * as whoop from "./whoop/client";
import {
  type Call, daysBetween, EXCLUDED_SOURCES, EXPORT_FORMAT, EXPORT_VERSION, GOOGLE_NOT_QUERIED, GOOGLE_PROBES, probeJson, rawTouches,
  runProbe, stripPrivate, trimToDay,
} from "./export-tag";

const parse = (s: string | null | undefined): unknown => {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
};
const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);
// Feste Liste, keine Eingabe von außen
const SKIP_SQL = EXCLUDED_SOURCES.map((s) => `'${s}'`).join(",");
/** Gespeicherte Rohantworten über dieser Größe nicht auswerten (Rechenzeit auf Workers Free) */
const RAW_MAX = 4_000_000;

export async function exportRoute(url: URL, env: Env, sub: string): Promise<Response> {
  const day = url.searchParams.get("day") || "";
  if (!isDay(day)) return json({ error: "Bitte einen Tag als JJJJ-MM-TT angeben." }, 400);
  if (sub === "tag") return json(await dayExport(env, day));
  if (sub === "google") return googleProbe(env, day, url.searchParams.get("id") || "", url.searchParams.get("name"));
  return json({ error: "Nicht gefunden" }, 404);
}

async function dayExport(env: Env, day: string) {
  const profile = await kvGetJson<{ tz?: string } | null>(env, "profile", null);
  const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
  const today = localDate(tz);

  const [metrics, acts, rawList, srcCfg, gMeta, gInfo, gConn, garminKey, wConn, sConn, whConn] = await Promise.all([
    env.DB.prepare(`SELECT metric, source, value, updated_at FROM daily_metrics WHERE day = ?1 AND source NOT IN (${SKIP_SQL}) ORDER BY metric, source`)
      .bind(day).all<{ metric: string; source: string; value: number; updated_at: number }>(),
    // Ohne die Spalten route und file_key: GPS-Spur und Speicherort der Originaldatei bleiben draußen
    env.DB.prepare(`SELECT source, external_id, type, data, laps, streams, best, weather, hr_hist, payload, updated_at FROM activities WHERE day = ?1 AND source NOT IN (${SKIP_SQL}) ORDER BY external_id`)
      .bind(day).all<Record<string, string | number | null>>(),
    // Erst nur die Schlüssel (Zeitraum „von_bis“), die Inhalte gleich einzeln
    env.DB.prepare(`SELECT source, kind, range_key, fetched_at FROM raw_records WHERE source NOT IN (${SKIP_SQL}) AND length(range_key) = 21 AND substr(range_key, 1, 10) <= ?1 AND substr(range_key, 12) >= ?1 ORDER BY fetched_at DESC`)
      .bind(day).all<{ source: string; kind: string; range_key: string; fetched_at: number }>(),
    kvGetJson<SrcCfg>(env, "srcCfg", DEFAULT_SRC_CFG),
    kvGetJson<GoogleMeta>(env, "googleMeta", {}),
    google.info(env),
    google.connected(env).catch(() => false),
    kvGet(env, "garminKey"),
    withingsConnected(env).catch(() => false),
    strava.connected(env).catch(() => false),
    whoop.connected(env).catch(() => false),
  ]);

  // Je Quelle und Art nur der neueste Abruf, der den Tag enthält (ältere Abrufe überlappen sich, z. B. die letzten 7 Tage)
  const groups = new Map<string, typeof rawList.results>();
  for (const r of rawList.results) {
    if (!rawTouches(r.range_key, day)) continue;
    const k = r.source + "/" + r.kind;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const rohdaten: unknown[] = [];
  for (const rows of groups.values()) {
    for (const r of rows.slice(0, 3)) {
      const row = await env.DB.prepare("SELECT payload FROM raw_records WHERE source = ?1 AND kind = ?2 AND range_key = ?3")
        .bind(r.source, r.kind, r.range_key).first<{ payload: string }>();
      if (!row?.payload) continue;
      if (row.payload.length > RAW_MAX) {
        rohdaten.push({ source: r.source, kind: r.kind, range_key: r.range_key, abgerufen: iso(r.fetched_at), fehlt: `zu groß zum Kürzen (${Math.round(row.payload.length / 1e6)} MB)` });
        break;
      }
      const { value, hits } = trimToDay(parse(row.payload), day);
      if (!hits) continue; // Zeitraum passt, enthält aber nichts zu diesem Tag (z. B. Google: „bis“ ausschließlich)
      rohdaten.push({ source: r.source, kind: r.kind, range_key: r.range_key, abgerufen: iso(r.fetched_at), eintraege: hits, weitereAbrufe: rows.length - 1, payload: stripPrivate(value) });
      break;
    }
  }

  const einheiten = acts.results.map((r) => stripPrivate({
    source: r.source, id: r.external_id, type: r.type,
    data: parse(r.data as string), laps: parse(r.laps as string), streams: parse(r.streams as string), best: parse(r.best as string),
    weather: parse(r.weather as string), hr_hist: parse(r.hr_hist as string), payload: parse(r.payload as string),
    aktualisiert: iso(r.updated_at as number),
  }));

  // Was die App daraus macht: ein Wert je Metrik nach Quellen-Priorität, zusammengeführte Einheiten (60 Tage Vorlauf
  // für Wochenschnitte und Bereiche)
  const back = Math.max(0, daysBetween(day, today));
  const built = await buildData(env, Math.min(4000, back + 61), { exclude: EXCLUDED_SOURCES }).catch(() => null);
  const app = built ? {
    tag: (built.daily as Record<string, unknown>)[day] ?? null,
    einheiten: Object.values(built.acts as Record<string, Record<string, unknown>>)
      .filter((a) => a.date === day)
      .map(({ laps: _laps, ...a }) => stripPrivate(a)),
  } : null;

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    hinweis: "Persönliche Gesundheitsdaten aus Health Hub, auf Wunsch der Person für einen Tag zusammengestellt. Nur an Menschen ihres Vertrauens weitergeben.",
    erstellt: new Date().toISOString(),
    tag: day,
    zeitzone: tz,
    appVersion: VERSION,
    quellen: { garmin: !!garminKey || !!env.GARMIN_API_KEY, withings: wConn, strava: sConn, whoop: whConn, google: gConn },
    quellenWahl: { ...DEFAULT_SRC_CFG, ...srcCfg },
    google: gConn || gMeta.lastRun ? {
      verbunden: gConn,
      rechte: gInfo.scopes,
      verbindungBis: gInfo.refreshExpires ? new Date(gInfo.refreshExpires).toISOString() : null,
      abgleich: {
        lastRun: gMeta.lastRun ?? null, lastOk: gMeta.lastOk ?? null, lastError: gMeta.lastError ?? null, oldest: gMeta.oldest ?? null,
        complete: !!gMeta.complete, count: gMeta.count ?? 0, filterNamen: gMeta.fields ?? {},
      },
    } : null,
    inhalt: {
      tageswerte: "Gespeicherte Tageswerte (daily_metrics), je Metrik und Quelle",
      einheiten: "Einheiten des Tages (activities): data, Runden, Verläufe, Bestleistungen, Wetter, Pulsverteilung und Rohantwort der Quelle, ohne GPS",
      rohdaten: "Gespeicherte Rohantworten (raw_records): je Quelle und Art der neueste Abruf, gekürzt auf die Einträge dieses Tages",
      app: "Was die App daraus macht: ein Wert je Metrik nach Quellen-Priorität (wie auf „Heute“) und die zusammengeführten Einheiten",
      googleLive: "Jede Google-Health-Datenart einzeln live abgefragt (Ortszeit, alle Quellen), Antworten unverändert; nur Ortsangaben bei Einheiten entfernt",
    },
    nichtDabei: [
      "Passwörter, Schlüssel und Zugangs-Tokens",
      "Stimmung, Freunde, Profil und Profilbild",
      "GPS-Routen und Ortsangaben (Breite, Länge, Ortsnamen)",
      "Strava- und WHOOP-Daten (deren Bedingungen erlauben die Weitergabe nicht)",
      "Withings-Rohantworten (nicht nach Tagen gespeichert; die Messwerte stehen unter tageswerte)",
    ],
    tageswerte: metrics.results.map((m) => ({ metric: m.metric, source: m.source, value: m.value, aktualisiert: iso(m.updated_at) })),
    einheiten,
    rohdaten,
    app,
    // Nur für die Oberfläche (kommt so nicht in die Datei): diese Arten einzeln über /api/export/google abrufen
    googleProben: gConn ? GOOGLE_PROBES.map((p) => p.id) : [],
    googleNichtAbgefragt: GOOGLE_NOT_QUERIED,
  };
}

// ---------- Google Health live ----------

const call: Call = async (url, init) => {
  try {
    const r = await fetch(url, init);
    return { status: r.status, text: await r.text(), retry: r.headers.get("Retry-After") };
  } catch (e) {
    return { status: 0, text: String((e as Error).message || e).slice(0, 300), retry: null };
  }
};

/** Eine Datenart live: Zugang wie im Abgleich (erneuert ihn bei Bedarf), Abruf und Zusammenbau in src/export-tag.ts */
async function googleProbe(env: Env, day: string, id: string, hint: string | null): Promise<Response> {
  const p = GOOGLE_PROBES.find((x) => x.id === id);
  if (!p) return json({ error: "Unbekannte Datenart" }, 400);
  let token: string;
  try {
    token = await google.getAccess(env);
  } catch (e) {
    // Nicht verbunden oder Verbindung abgelaufen: die Oberfläche fragt die übrigen Arten gar nicht erst ab
    return json({ id: p.id, type: p.type, method: p.method, ok: false, stop: "verbindung", fehler: String((e as Error).message || e).slice(0, 300) });
  }
  // Schreibweise des Typs im Filter: gelernt im Abgleich, sonst die zuletzt erfolgreiche (von der Oberfläche), sonst snake_case
  const learned = (await kvGetJson<GoogleMeta>(env, "googleMeta", {})).fields?.[p.type];
  const base = p.beta ? google.API.replace(/\/v4$/, "/v4beta") : google.API;
  const r = await runProbe(p, day, { call, base, token, first: learned || (hint === "c" ? "c" : "s") });
  return respond(probeJson(p, r, new Date().toISOString()));
}
