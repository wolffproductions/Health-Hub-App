// Wetter je Einheit (#54): im Cron für Einheiten mit Route das Wetter bei Open-Meteo holen, neueste zuerst, 12 pro Lauf.
// Eigene Spalte `activities.weather` (der Sync überschreibt `data`): JSON Wx, „{}“ = kein Wetter (keine Route, kein Wert).
import type { Env } from "./env";
import { json, kvGetJson, kvPut, localDate } from "./util";
import { pickHour, wxUrl } from "./wetter";
import type { Profile } from "./garmin/sync";

interface Cfg { on: boolean }
export const weatherOn = async (env: Env) => (await kvGetJson<Cfg>(env, "weatherCfg", { on: false })).on;

export async function weatherStep(env: Env, max = 12) {
  if (!(await weatherOn(env))) return;
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const { results } = await env.DB.prepare(
    "SELECT source, external_id, day, data, json_extract(route, '$[0]') AS p0 FROM activities WHERE weather IS NULL AND day <= ? AND ((route IS NOT NULL AND route <> '[]') OR route_done = 1) ORDER BY day DESC LIMIT ?",
  ).bind(today, max).all<{ source: string; external_id: string; day: string; data: string; p0: string | null }>();
  for (const r of results) {
    let wx: unknown = {};
    try {
      const p = r.p0 ? (JSON.parse(r.p0) as number[]) : null;
      const a = JSON.parse(r.data || "{}");
      if (p && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]) && a.start) {
        const res = await fetch(wxUrl(p[0], p[1], r.day, today), { signal: AbortSignal.timeout(8000) });
        if (res.status === 429) break; // Limit erreicht: im nächsten Lauf weiter
        if (res.ok) wx = pickHour(await res.json(), a.start, a.min || 0) || {};
      }
    } catch { /* einzelne Einheit überspringen */ }
    await env.DB.prepare("UPDATE activities SET weather = ? WHERE source = ? AND external_id = ?").bind(JSON.stringify(wx), r.source, r.external_id).run();
  }
}

/** Konto → Datenquellen → Wetter: Haken an/aus */
export async function weatherRoute(req: Request, env: Env, ctx: ExecutionContext) {
  if (req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { on?: unknown };
    const on = b.on === true;
    await kvPut(env, "weatherCfg", JSON.stringify({ on }));
    if (on) ctx.waitUntil(weatherStep(env).catch((e) => console.error("wetter", e)));
  }
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE weather IS NOT NULL AND weather <> '{}'").first<{ n: number }>();
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE weather IS NULL AND route IS NOT NULL").first<{ n: number }>();
  return json({ on: await weatherOn(env), done: n?.n ?? 0, open: open?.n ?? 0 });
}
