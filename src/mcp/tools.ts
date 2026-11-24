// Werkzeuge des MCP-Zugangs (#5). Alle nur lesend, außer dem Trainingsplan (#20, nur mit Freigabe „plan“). Grundlage ist dieselbe Aufbereitung wie für die
// Oberfläche (buildData: Quellen-Priorität, Strava-Doppelungen zusammengeführt, Erholungs-Ampel).
// Stimmung (Balance) nur, wenn unter Konto → Claude ausdrücklich freigegeben (CLAUDE.md).
// WHOOP-Daten (#119) ebenso nur mit Freigabe: Die WHOOP-API-Bedingungen (4.2) verlangen für die Weitergabe an Dritte
// die ausdrückliche Zustimmung der Person. Ohne Freigabe rechnet alles (auch die Ampel) ohne WHOOP.
// Google Health ebenso: Googles Regeln für Nutzerdaten (Limited Use) erlauben die Weitergabe nur für eine Funktion,
// die die Person selbst ausdrücklich will. Deshalb eigene Freigabe, Standard aus.
import type { Env } from "../env";
import { buildData } from "../data";
import { addDays, isDay, kvGetJson, localDate, round } from "../util";
import { ToolError, type McpTool } from "./server";
import { cleanSession, mergeSessions, TYPES, type TSession } from "../training";
import { loadPlan, savePlan, trainingView } from "../training-api";

/** plan = Claude darf den Trainingsplan schreiben */
export interface McpSettings { mood: boolean; whoop?: boolean; google?: boolean; plan?: boolean }
export const DEFAULT_MCP_SETTINGS: McpSettings = { mood: false, whoop: false, google: false, plan: false };
async function mayWritePlan(env: Env) {
  const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
  if (!set.plan) throw new ToolError("Claude darf den Trainingsplan noch nicht schreiben. Die Person kann das in der App unter Konto → Claude freigeben („Claude darf meinen Trainingsplan schreiben“).");
}
const SESSION_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "JJJJ-MM-TT" },
    type: { type: "string", enum: [...TYPES], description: "easy locker · long langer Lauf · strides locker mit Steigerungen · tempo Schwelle · interval Intervalle · mp langer Lauf mit Wettkampftempo · race Wettkampf · recovery Regeneration · strength Kraft · cross Alternativtraining" },
    title: { type: "string", description: "kurz, z. B. „Intervalle 5 × 1000 m“" },
    detail: { type: "string", description: "Ablauf in 1–2 Sätzen mit Pace und Puls, Du-Form, z. B. „2 km einlaufen, 5 × 1000 m in 3:25–3:30 /km, 3 min Trab, auslaufen“" },
    km: { type: "number", description: "Gesamtstrecke inkl. Ein-/Auslaufen" },
    min: { type: "number", description: "Dauer in Minuten (statt km, z. B. Kraft)" },
    reps: { type: "number", description: "Anzahl Wiederholungen harter Einheiten (fürs Abhaken in Prozent)" },
    pace_per_km: { type: "string", description: "Zielpace der Belastung bzw. Obergrenze locker als „m:ss“" },
    hr_max: { type: "number", description: "obere Pulsgrenze in bpm (z. B. lockere Läufe)" },
  },
  required: ["date", "type", "title", "detail"],
  additionalProperties: false,
};
/** Quellen, die Claude ohne Freigabe nicht sieht */
export const mcpExclude = (set: McpSettings) => [...(set.whoop ? [] : ["whoop"]), ...(set.google ? [] : ["google"])];

const MAX_DAYS = 400;
const METRICS_DOC =
  "Metriken je Tag (fehlende Werte fehlen einfach): rhr Ruhepuls bpm · hrv HRV letzte Nacht ms (hrvWk Wochenschnitt, " +
  "hrvLo/hrvHi Normalbereich) · slp Schlaf h · deep/rem h · awake min · score Schlafscore 0–100 · shr Puls im Schlaf bpm · " +
  "resp Atemzüge/min · spo2/spo2Lo % · bed/wake Uhrzeit in h (bed > 24 = nach Mitternacht) · stress/stressMax 0–100 · " +
  "stRest/stLow/stMed/stHi min je Stressstufe · bbMax/bbMin/bbNow/bbWake Body Battery 0–100 · bbCharged/bbDrained Punkte · " +
  "steps · vig/mod Intensitätsminuten · kg · fat % · muscle/water/bone kg · visceral · fitAge/fitAgeAch Jahre · " +
  "rec WHOOP-Recovery % · strain WHOOP Day Strain 0–21 · skinT Hauttemperatur °C · kcal Tagesumsatz · hrvSrc Quelle der HRV-Werte.";

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
  const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
  const data = await buildData(env, from ? daysBack(today, from) : 60, { exclude: mcpExclude(set) });
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
    id: a.id, date: a.date, start: a.start, sport: sp, type: a.type, name: (a.src === "strava" ? undefined : a.garminName ?? a.name) || undefined, // nie Strava-Titel (#113)
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
      const row = await env.DB.prepare("SELECT source, data, laps FROM activities WHERE external_id = ? LIMIT 1").bind(id).first<{ source: string; data: string; laps: string | null }>();
      // WHOOP-Einheiten nur mit Freigabe (#119)
      const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
      if (!row || mcpExclude(set).includes(row.source)) throw new ToolError("Keine Einheit mit dieser id.");
      const a = JSON.parse(row.data);
      // Runden von Strava nicht an Claude (Strava-Bedingungen, Issue 50)
      const laps = row.laps && row.source !== "strava" ? (JSON.parse(row.laps) as any[]) : [];
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
    name: "get_race_predictions",
    title: "Wettkampfprognosen",
    description: "Prognose für 5 km, 10 km, Halbmarathon und Marathon (Zeit in Sekunden und als Text, Tempo je km, ggf. Spanne) " +
      "mit den verwendeten Quellen (Garmins VO2max, Form aus Läufen, Intervalle) und warum eine Quelle zählt oder nicht. " +
      "Dieselbe Rechnung wie in der App unter Statistiken → Leistung. Schätzung nach Daniels, kein Garmin-Wert.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(env) {
      const { data } = await load(env);
      const p = (data as any).prognose;
      if (!p) throw new ToolError("Noch keine Prognose: Es fehlen Garmins VO2max und schnelle Abschnitte aus Läufen.");
      const t = (sec: number | null) => {
        if (sec == null) return null;
        const r = Math.round(sec), h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), x = String(r % 60).padStart(2, "0");
        return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : m + ":" + x;
      };
      return {
        rough: p.rough, mode: p.mode, volume: p.volume,
        races: p.races.map((r: any) => ({ race: r.label, time: t(r.sec), seconds: Math.round(r.sec), pacePerKm: t(r.pace), range: r.lo != null ? [t(r.lo), t(r.hi)] : undefined, vo2Used: r.vo2, enduranceSurchargePct: Math.round(r.penalty * 1000) / 10 })),
        sources: p.sources.map((s: any) => ({ source: s.key, vo2: Math.round(s.vo2 * 10) / 10, counted: s.used, confidence: Math.round(s.conf * 100) / 100, explanation: s.why })),
      };
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
  {
    name: "get_training_plan",
    title: "Trainingsplan lesen",
    description: "Der Trainingsplan in der App mit Ziel, Wochen-Notiz und Einheiten. Vergangene Einheiten sind mit der gelaufenen " +
      "Einheit abgeglichen: done.pct = Erfüllung in % (locker/lang: Strecke und Puls über 79 % HFmax; Schwelle/Intervalle: " +
      "Wiederholungen und Tempo zu pace_per_km), done.why = Begründung, missed = nicht gelaufen. Standard: 14 Tage zurück bis 28 Tage voraus. " +
      "Vor dem Anpassen eines Plans zuerst lesen.",
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, additionalProperties: false },
    async run(env, args) {
      const set = await kvGetJson<McpSettings>(env, "mcpSettings", DEFAULT_MCP_SETTINGS);
      const pre = await load(env);
      const from = isDay(args.from) ? args.from : addDays(pre.today, -14), to = isDay(args.to) ? args.to : addDays(pre.today, 28);
      const v = await trainingView(env, { from, to, exclude: mcpExclude(set) });
      return {
        today: v.today, goal: v.goal, weekNote: v.note, canWrite: !!set.plan, updated: v.updated || null,
        sessions: v.sessions.map(({ index, moved, pace, hrMax, done, ...s }) => ({
          ...s, pace_per_km: pace ? Math.floor(pace / 60) + ":" + String(pace % 60).padStart(2, "0") : undefined, hr_max: hrMax ?? undefined,
          movedInApp: moved || undefined,
          done: done ? { pct: done.pct, why: done.why, km: done.km, activityId: done.id || undefined, manual: done.manual || undefined } : undefined,
        })),
      };
    },
  },
  {
    name: "set_training_plan",
    title: "Trainingsplan schreiben",
    write: true,
    description: "Einheiten in den Trainingsplan der App schreiben (nur mit Freigabe unter Konto → Claude). Ersetzt alle Einheiten ab " +
      "replace_from (Standard: frühester Tag der neuen Einheiten) bis replace_to (Standard: Ende des Plans); ältere bleiben als Verlauf. " +
      "Ruhetage einfach weglassen. Die App zeigt die Einheit des Tages auf „Heute“ und im Morgen-Push und hakt gelaufene Einheiten ab. " +
      "Paces und Pulsgrenzen aus den echten Daten der Person ableiten (get_activities, get_race_predictions), Umfang vorsichtig steigern. " +
      "Strava- und WHOOP-Daten nicht zum Planen verwenden. Optional goal (Ziel als Satz) und note (kurze Wochen-Notiz, Du-Form).",
    inputSchema: {
      type: "object",
      properties: {
        sessions: { type: "array", items: SESSION_SCHEMA, maxItems: 200 },
        replace_from: { type: "string", description: "JJJJ-MM-TT" },
        replace_to: { type: "string", description: "JJJJ-MM-TT" },
        goal: { type: "string", description: "z. B. „Halbmarathon Berlin 7.3.2027 in 1:12“" },
        note: { type: "string", description: "kurze Notiz zur Woche, erscheint auf „Heute“" },
      },
      required: ["sessions"],
      additionalProperties: false,
    },
    async run(env, args) {
      await mayWritePlan(env);
      const raw = Array.isArray(args.sessions) ? args.sessions : null;
      if (!raw) throw new ToolError("sessions fehlt.");
      if (raw.length > 200) throw new ToolError("Höchstens 200 Einheiten auf einmal.");
      const add: TSession[] = [];
      for (const x of raw) { const s = cleanSession(x); if (typeof s === "string") throw new ToolError(s); add.push(s); }
      const rf = isDay(args.replace_from) ? args.replace_from : null, rt = isDay(args.replace_to) ? args.replace_to : null;
      if (!add.length && !rf) throw new ToolError("Keine Einheiten: Zum Leeren eines Zeitraums replace_from (und replace_to) angeben.");
      const { today } = await load(env);
      let plan = mergeSessions(await loadPlan(env), add, rf, rt);
      if (typeof args.goal === "string") plan = { ...plan, goal: args.goal.trim().slice(0, 200) || null };
      if (typeof args.note === "string") plan = { ...plan, note: args.note.trim() ? { date: today, text: args.note.trim().slice(0, 600) } : null };
      await savePlan(env, plan);
      return { ok: true, saved: add.length, totalSessions: plan.sessions.length, first: plan.sessions[0]?.date || null, last: plan.sessions[plan.sessions.length - 1]?.date || null };
    },
  },
  {
    name: "set_plan_note",
    title: "Wochen-Notiz schreiben",
    write: true,
    description: "Kurze Notiz zum Plan (z. B. Wochenrückblick und was sich ändert), erscheint in der App auf „Heute“. Leerer Text löscht sie. Nur mit Freigabe.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    async run(env, args) {
      await mayWritePlan(env);
      const { today } = await load(env);
      const t = typeof args.text === "string" ? args.text.trim().slice(0, 600) : "";
      await savePlan(env, { ...(await loadPlan(env)), note: t ? { date: today, text: t } : null });
      return { ok: true };
    },
  },
];

