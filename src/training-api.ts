// Trainingsplan von Claude (#20): laden, mit gelaufenen Einheiten abgleichen (Abhaken mit Prozent aus src/plan.ts),
// App-Schnittstelle /api/training (Anzeige, Verschieben, selbst abhaken). Schreiben tut nur Claude (src/mcp/tools.ts).
import type { Env } from "./env";
import { buildData } from "./data";
import { json, kvGetJson, kvPut, localDate } from "./util";
import { checkOff, zonesFrom, type DoneRun, type Plan, type Session } from "./plan";
import { EMPTY_PLAN, mondayOf, moveSession, type TPlan, type TSession } from "./training";
import type { Profile } from "./garmin/sync";

export interface TView extends TSession { done?: Session["done"]; missed?: boolean; index: number }
export interface TrainingView { goal: string | null; note: TPlan["note"]; updated: string; today: string; sessions: TView[] }

const RUN_TYPES = new Set(["easy", "long", "strides", "tempo", "interval", "mp", "race", "recovery"]);

export async function loadPlan(env: Env): Promise<TPlan> {
  const p = await kvGetJson<TPlan | null>(env, "trainingPlan", null);
  return p ? { ...EMPTY_PLAN, ...p } : { ...EMPTY_PLAN };
}
export const savePlan = (env: Env, p: TPlan) => kvPut(env, "trainingPlan", JSON.stringify({ ...p, updated: new Date().toISOString() }));

/** Plan von `from` bis `to` mit Haken und Prozent; exclude = Quellen, die nicht verwendet werden dürfen (Claude-Freigaben) */
export async function trainingView(env: Env, opts: { from?: string; to?: string; exclude?: string[] } = {}): Promise<TrainingView> {
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const today = localDate(profile?.tz || env.TIMEZONE || "Europe/Berlin");
  const plan = await loadPlan(env);
  const from = opts.from || "0000-01-01", to = opts.to || "9999-12-31";
  const idx = new Map<string, number>();
  const list: TView[] = plan.sessions.map((s) => { const k = idx.get(s.date) || 0; idx.set(s.date, k + 1); return { ...s, index: k }; })
    .filter((s) => s.date >= from && s.date <= to);
  // Abgleich nur für Vergangenes und heute, mit den Läufen der letzten Wochen
  const due = list.filter((s) => s.date <= today && RUN_TYPES.has(s.type));
  if (due.length) {
    const data = await buildData(env, 120, { exclude: opts.exclude });
    const runs: DoneRun[] = (Object.values(data.acts) as Array<Record<string, any>>)
      .filter((a) => /running/.test(a.type || "") && a.id && a.date && a.km > 0)
      .map((a) => ({ id: String(a.id), date: a.date, km: a.km, min: a.min || 0, hr: a.hr, laps: Array.isArray(a.laps) ? a.laps : null }));
    const zl = (Array.isArray(data.zones) ? data.zones : []) as Array<{ sport?: string; max?: number }>;
    const zone = zl.find((z) => z && /RUN/i.test(z.sport || "") && z.max) || zl.find((z) => z && z.max);
    // checkOff kennt nur die Plan-Einheiten des Regel-Plans: hier in Wochen gruppiert nachgebaut
    const conv = due.map((s) => ({ src: s, ses: { date: s.date, type: s.type === "recovery" ? "easy" : s.type, title: s.title, km: s.km ?? 0, detail: s.detail, zone: "", reps: s.reps ?? undefined, repsMin: s.repsMin ?? undefined, pace: s.pace ?? undefined } as Session }));
    const weeks = new Map<string, Session[]>();
    for (const c of conv) weeks.set(mondayOf(c.ses.date), [...(weeks.get(mondayOf(c.ses.date)) || []), c.ses]);
    const p = { weeks: [...weeks.entries()].map(([start, sessions]) => ({ start, sessions })), paces: { hr: zonesFrom(zone) } } as unknown as Plan;
    const manual = await kvGetJson<string[]>(env, "trainingManual", []);
    checkOff(p, runs, today, manual);
    for (const c of conv) { if (c.ses.done) c.src.done = c.ses.done; if (c.ses.missed) c.src.missed = true; }
  }
  // Kraft/Alternativ: selbst abhaken, sonst nicht als verpasst werten
  const manual = await kvGetJson<string[]>(env, "trainingManual", []);
  for (const s of list) if (!RUN_TYPES.has(s.type) && s.date <= today && manual.includes(s.date) && !s.done) s.done = { id: null, pct: null, why: "selbst abgehakt", km: null, sec: null, manual: true };
  return { goal: plan.goal, note: plan.note, updated: plan.updated, today, sessions: list };
}

/** /api/training: GET Plan (±Wochen), POST move {from, index, to} | tick {date} */
export async function trainingRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { action?: string; from?: string; to?: string; index?: number; date?: string };
    if (b.action === "move") {
      const r = moveSession(await loadPlan(env), String(b.from), Number(b.index) || 0, String(b.to));
      if (typeof r === "string") return json({ ok: false, error: r }, 400);
      await savePlan(env, r);
    } else if (b.action === "tick") {
      if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return json({ ok: false, error: "Kein Tag angegeben." }, 400);
      const m = new Set(await kvGetJson<string[]>(env, "trainingManual", []));
      if (m.has(b.date)) m.delete(b.date); else m.add(b.date);
      await kvPut(env, "trainingManual", JSON.stringify([...m].sort().slice(-400)));
    } else return json({ ok: false, error: "Unbekannte Aktion." }, 400);
  }
  const from = url.searchParams.get("from") || undefined, to = url.searchParams.get("to") || undefined;
  return json({ ok: true, ...(await trainingView(env, { from, to })) });
}
