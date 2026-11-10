// Werkzeuge des MCP-Zugangs (#5). Alle nur lesend. Grundlage ist dieselbe Aufbereitung wie für die
// Oberfläche (buildData: Quellen-Priorität, Strava-Doppelungen zusammengeführt, Erholungs-Ampel).
// Stimmung (Balance) nur, wenn unter Konto → Claude ausdrücklich freigegeben (CLAUDE.md).
import type { Env } from "../env";
import { buildData } from "../data";
import { addDays, isDay, kvGetJson, localDate, round } from "../util";
import { ToolError, type McpTool } from "./server";

export interface McpSettings { mood: boolean }
export const DEFAULT_MCP_SETTINGS: McpSettings = { mood: false };

const MAX_DAYS = 400;
const METRICS_DOC =
  "Metriken je Tag (fehlende Werte fehlen einfach): rhr Ruhepuls bpm · hrv HRV letzte Nacht ms (hrvWk Wochenschnitt, " +
  "hrvLo/hrvHi Normalbereich) · slp Schlaf h · deep/rem h · awake min · score Schlafscore 0–100 · shr Puls im Schlaf bpm · " +
  "resp Atemzüge/min · spo2/spo2Lo % · bed/wake Uhrzeit in h (bed > 24 = nach Mitternacht) · stress/stressMax 0–100 · " +
  "stRest/stLow/stMed/stHi min je Stressstufe · bbMax/bbMin/bbNow/bbWake Body Battery 0–100 · bbCharged/bbDrained Punkte · " +
  "steps · vig/mod Intensitätsminuten · kg · fat % · muscle/water/bone kg · visceral · fitAge/fitAgeAch Jahre.";

const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const num = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : undefined);

/** Zeitraum aus den Argumenten; Standard die letzten `def` Tage, höchstens MAX_DAYS */
function range(today: string, args: Record<string, unknown>, def: number) {
  const to = str(args.to) ?? today, from = str(args.from) ?? addDays(to, -def + 1);
  if (!isDay(from) || !isDay(to)) throw new ToolError("Datum bitte als JJJJ-MM-TT angeben.");
  if (from > to) throw new ToolError("„from“ liegt nach „to“.");
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 864e5) throw new ToolError(`Höchstens ${MAX_DAYS} Tage auf einmal.`);
  return { from, to };
}
const daysBack = (today: string, from: string) => Math.max(28, Math.min(4000, Math.round((Date.parse(today) - Date.parse(from)) / 864e5) + 2));

async function load(env: Env, from?: string) {
  const profile = await kvGetJson<{ tz?: string } | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const data = await buildData(env, from ? daysBack(today, from) : 60);
  return { today, data };
}

const sportOf = (type: string | null | undefined) => {
  const t = String(type || "");
  if (/running|trail|treadmill/.test(t)) return "run";
  if (/cycl|biking|ride|bike/.test(t)) return "ride";
  if (/swim/.test(t)) return "swim";
  if (/strength|fitness|hiit|yoga|pilates/.test(t)) return "strength";
  return "other";
};
const pace = (km: number, min: number) => {
  if (!km || !min) return null;
  const s = Math.round((min * 60) / km);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + " min/km";
};

/** Kurzfassung einer Einheit für Listen */
function summary(a: any) {
  const sp = sportOf(a.type);
  return {
    id: a.id, date: a.date, start: a.start, sport: sp, type: a.type, name: a.name || undefined,
    km: a.km, min: a.min, pace: sp === "run" ? pace(a.km, a.min) : undefined,
    kmh: sp === "ride" && a.km && a.min ? round(a.km / (a.min / 60), 1) : undefined,
    hr: a.hr ?? undefined, maxHr: a.maxHr ?? undefined, elev: a.elev ?? undefined,
    trainingEffect: a.te ?? undefined, anaerobicEffect: a.teAn ?? undefined, load: a.load ?? undefined,
    label: a.label ?? undefined, vo2max: a.vo2 ?? undefined, kcal: a.kcal ?? undefined,
    laps: Array.isArray(a.laps) ? a.laps.length : undefined, source: a.src ?? undefined,
  };
}
const actsIn = (data: any, from: string, to: string) =>
  Object.values(data.acts as Record<string, any>).filter((a) => a.date >= from && a.date <= to)
    .sort((x, y) => (x.date + x.start < y.date + y.start ? -1 : 1));
const dailyIn = (data: any, from: string, to: string) =>
  Object.values(data.daily as Record<string, any>).filter((d) => d.d >= from && d.d <= to).sort((x, y) => (x.d < y.d ? -1 : 1));

const avg = (rows: any[], k: string) => {
  const v = rows.map((r) => r[k]).filter((x) => typeof x === "number");
  return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 1) : null;
};
/** Montag der Woche */
const weekStart = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));

export const TOOLS: McpTool<Env>[] = [
  {
    name: "get_overview",
    title: "Überblick",
    description: "Schneller Überblick: Erholungs-Ampel von heute, Tageswerte der letzten 7 Tage, Schnitt der letzten 28 Tage " +
      "für Ruhepuls, HRV, Schlaf, Stress und die Einheiten der letzten 7 Tage. Gut als erster Aufruf.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(env) {
      const { today, data } = await load(env);
      const last7 = dailyIn(data, addDays(today, -6), today), last28 = dailyIn(data, addDays(today, -27), today);
      const keys = ["rhr", "hrv", "slp", "score", "stress", "bbNow", "bbMax", "steps"];
      return {
        today,
        ampel: data.ampel ?? null,
        last7Days: last7.map((d) => Object.fromEntries([["date", d.d], ...keys.filter((k) => d[k] != null).map((k) => [k, d[k]])])),
        avg28Days: Object.fromEntries(["rhr", "hrv", "slp", "score", "stress"].map((k) => [k, avg(last28, k)])),
        activities7Days: actsIn(data, addDays(today, -6), today).map(summary),
        dataUpdated: data.updated,
      };
    },
  },
  {
    name: "get_daily_metrics",
    title: "Tageswerte",
    description: "Tageswerte für einen Zeitraum (Standard: letzte 30 Tage, höchstens 400). " + METRICS_DOC,
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Erster Tag, JJJJ-MM-TT" },
        to: { type: "string", description: "Letzter Tag, JJJJ-MM-TT (Standard heute)" },
        metrics: { type: "array", items: { type: "string" }, description: "Nur diese Metriken, z. B. [\"rhr\",\"hrv\",\"slp\"]" },
      },
      additionalProperties: false,
    },
    async run(env, args) {
      const pre = await load(env);
      const { from, to } = range(pre.today, args, 30);
      const { data } = await load(env, from);
      const only = Array.isArray(args.metrics) ? args.metrics.filter((m): m is string => typeof m === "string") : null;
      return dailyIn(data, from, to).map((d) => {
        const { d: date, ...rest } = d;
        return { date, ...(only ? Object.fromEntries(only.filter((k) => rest[k] != null).map((k) => [k, rest[k]])) : rest) };
      });
    },
  },
  {
    name: "get_activities",
    title: "Einheiten",
    description: "Trainingseinheiten in einem Zeitraum (Standard: letzte 30 Tage), neueste zuletzt. Je Einheit Sportart, " +
      "Distanz km, Dauer min, Pace bzw. km/h, Puls, Höhenmeter, Trainingseffekt, Last, Garmin-Einordnung, VO2max, kcal, Anzahl Runden. " +
      "Details mit Runden über get_activity.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Erster Tag, JJJJ-MM-TT" },
        to: { type: "string", description: "Letzter Tag, JJJJ-MM-TT" },
        sport: { type: "string", enum: ["run", "ride", "swim", "strength", "other"], description: "Nur diese Sportart" },
      },
      additionalProperties: false,
    },
    async run(env, args) {
      const pre = await load(env);
      const { from, to } = range(pre.today, args, 30);
      const { data } = await load(env, from);
      const sport = str(args.sport);
      return actsIn(data, from, to).map(summary).filter((a) => !sport || a.sport === sport);
    },
  },
  {
    name: "get_activity",
    title: "Einheit im Detail",
    description: "Eine Einheit mit allen Werten und Runden (je Runde Länge m, Zeit s, Pace, Puls). Kadenz, Bodenkontaktzeit ms, " +
      "vertikale Oszillation cm, Leistung W, Zeit je Pulszone s, schnellste Abschnitte (5 km, 10 km, HM, M) in s.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "id aus get_activities" } }, required: ["id"], additionalProperties: false },
    async run(env, args) {
      const id = str(args.id);
      if (!id) throw new ToolError("Bitte eine id aus get_activities angeben.");
      const row = await env.DB.prepare("SELECT data, laps FROM activities WHERE external_id = ? LIMIT 1").bind(id).first<{ data: string; laps: string | null }>();
      if (!row) throw new ToolError("Keine Einheit mit dieser id.");
      const a = JSON.parse(row.data);
      const laps = row.laps ? (JSON.parse(row.laps) as any[]) : [];
      return {
        ...summary(a),
        cadence: a.cad ?? undefined, groundContactMs: a.gct ?? undefined, verticalOscillationCm: a.vo ?? undefined,
        power: a.pw ?? undefined, normPower: a.np ?? undefined, hrZoneSeconds: a.z ?? undefined,
        fastest: { "5k": a.f5k ?? undefined, "10k": a.f10k ?? undefined, hm: a.fHm ?? undefined, m: a.fM ?? undefined },
        laps: laps.map((l, i) => ({
          lap: i + 1, m: l.m ?? (l.v && l.s ? Math.round(l.v * l.s) : undefined), s: l.s,
          pace: l.v ? pace(1, 1000 / l.v / 60) : undefined, hr: l.hr ?? undefined,
        })),
      };
    },
  },
  {
    name: "get_weekly_summary",
    title: "Wochenübersicht",
    description: "Je Kalenderwoche (Montag bis Sonntag) Umfang und Last nach Sportart sowie Schnitt von Ruhepuls, HRV und Schlaf. " +
      "Standard die letzten 12 Wochen, höchstens 52.",
    inputSchema: { type: "object", properties: { weeks: { type: "integer", minimum: 1, maximum: 52 } }, additionalProperties: false },
    async run(env, args) {
      const weeks = Math.max(1, Math.min(52, Math.round(num(args.weeks) ?? 12)));
      const pre = await load(env);
      const first = addDays(weekStart(pre.today), -7 * (weeks - 1));
      const { data } = await load(env, first);
      const out = [];
      for (let w = 0; w < weeks; w++) {
        const from = addDays(first, 7 * w), to = addDays(from, 6);
        const acts = actsIn(data, from, to), days = dailyIn(data, from, to);
        const bySport: Record<string, { count: number; km: number; hours: number; load: number }> = {};
        for (const a of acts) {
          const s = (bySport[sportOf(a.type)] ??= { count: 0, km: 0, hours: 0, load: 0 });
          s.count++; s.km += a.km || 0; s.hours += (a.min || 0) / 60; s.load += a.load || 0;
        }
        for (const s of Object.values(bySport)) { s.km = round(s.km, 1)!; s.hours = round(s.hours, 1)!; s.load = round(s.load, 0)!; }
        out.push({ weekStart: from, sports: bySport, rhr: avg(days, "rhr"), hrv: avg(days, "hrv"), sleepH: avg(days, "slp") });
      }
      return out;
    },
  },
  {
    name: "get_vo2max",
    title: "VO2max-Verlauf",
    description: "VO2max je Tag und Sportart (run/ride): automatisch von Garmin je Einheit, dazu eigene Einträge (gelten am selben Tag vorrangig). Standard letzte 365 Tage.",
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, additionalProperties: false },
    async run(env, args) {
      const pre = await load(env);
      const { from, to } = range(pre.today, { from: args.from ?? addDays(pre.today, -364), to: args.to }, 365);
      const { data } = await load(env, from);
      const by = new Map<string, { date: string; sport: string; value: number; source: string }>();
      for (const a of actsIn(data, from, to)) {
        const s = sportOf(a.type);
        if (!a.vo2 || (s !== "run" && s !== "ride")) continue;
        const k = a.date + "|" + s, e = by.get(k);
        if (!e || a.vo2 > e.value) by.set(k, { date: a.date, sport: s, value: a.vo2, source: "garmin" });
      }
      const { results } = await env.DB.prepare("SELECT day, sport, value FROM vo2 WHERE day >= ? AND day <= ?").bind(from, to)
        .all<{ day: string; sport: string; value: number }>();
      for (const r of results) by.set(r.day + "|" + r.sport, { date: r.day, sport: r.sport, value: r.value, source: "eigener Eintrag" });
      return [...by.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    },
  },
  {
    name: "get_mood",
    title: "Stimmung",
    description: "Stimmung je Tag (1–5), Stichworte und Notiz aus dem Reiter Balance. Nur verfügbar, wenn die Person es unter Konto → Claude freigegeben hat.",
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, additionalProperties: false },
    async run(env, args) {
      const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
      if (!set.mood) throw new ToolError("Die Stimmung ist für Claude nicht freigegeben. Freigeben kann man sie in der App unter Konto → Claude.");
      const pre = await load(env);
      const { from, to } = range(pre.today, args, 30);
      const { results } = await env.DB.prepare("SELECT day, value, tags, note FROM mood WHERE day >= ? AND day <= ? ORDER BY day").bind(from, to)
        .all<{ day: string; value: number; tags: string | null; note: string | null }>();
      return results.map((r) => ({ date: r.day, mood: r.value, tags: r.tags ? JSON.parse(r.tags) : [], note: r.note || undefined }));
    },
  },
];
