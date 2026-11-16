// Ausrüstung (#52): Speichern in kv (`gear`) und Abgleich mit Strava. Rechnung in ausruestung.ts.
import type { Env } from "./env";
import { json, kvGetJson, kvPut } from "./util";
import * as strava from "./strava/client";
import { buildData } from "./data";
import { cleanItem, emptyStore, gearUsage, mergeStravaGear, type GearStore } from "./ausruestung";

const MAX_ITEMS = 50;
const loadStore = (env: Env) => kvGetJson<GearStore>(env, "gear", emptyStore());
const saveStore = (env: Env, s: GearStore) => kvPut(env, "gear", JSON.stringify(s));

/** Schuhe und Räder aus Strava holen (eine Anfrage: GET /athlete). Fehler werfen. */
export async function syncStravaGear(env: Env): Promise<GearStore> {
  const token = await strava.getAccess(env);
  const athlete = await strava.api(token, "/athlete");
  const s = mergeStravaGear(await loadStore(env), athlete);
  await saveStore(env, s);
  return s;
}

/** Im Cron: höchstens einmal am Tag, nur mit verbundenem Strava. Fehler egal. */
export async function stravaGearDaily(env: Env) {
  if (!(await strava.connected(env))) return;
  const s = await loadStore(env);
  if (s.stravaAt && Date.now() - Date.parse(s.stravaAt) < 20 * 3600e3) return;
  await syncStravaGear(env).catch(() => null);
}

export async function gearRoute(req: Request, env: Env) {
  // Kilometerstand über dieselben Einheiten wie die Oberfläche (Strava-Doppelungen zusammengeführt)
  const out = async (s: GearStore) => {
    const data: any = await buildData(env, 4000);
    return json({ ...s, usage: gearUsage(s, Object.values(data.acts || {}) as any[]), stravaConnected: await strava.connected(env) });
  };
  if (req.method === "GET") return out(await loadStore(env));
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const s = await loadStore(env);
  switch (body.action) {
    case "save": {
      const existing = body.id ? s.items.find((i) => i.id === body.id) : undefined;
      if (body.id && !existing) return json({ ok: false, error: "Nicht gefunden." }, 404);
      if (!existing && s.items.length >= MAX_ITEMS) return json({ ok: false, error: "Höchstens " + MAX_ITEMS + " Teile." }, 400);
      const it = cleanItem(body.item, existing);
      if (typeof it === "string") return json({ ok: false, error: it }, 400);
      if (existing) Object.assign(existing, it);
      else s.items.push({ ...it, id: "e-" + crypto.randomUUID().slice(0, 8) });
      break;
    }
    case "delete": {
      // Nur selbst angelegte; Strava-Teile kommen beim nächsten Abgleich wieder, die gehen in den Ruhestand
      const it = s.items.find((i) => i.id === body.id);
      if (!it || it.strava) return json({ ok: false, error: "Nur selbst angelegte Teile lassen sich löschen." }, 400);
      s.items = s.items.filter((i) => i.id !== it.id);
      for (const [k, v] of Object.entries(s.assign)) if (v === it.id) delete s.assign[k];
      break;
    }
    case "assign": {
      const act = String(body.act || "").slice(0, 40), gear = body.gear;
      if (!act) return json({ ok: false, error: "Einheit fehlt." }, 400);
      if (gear === null || gear === undefined) delete s.assign[act];          // zurück zur Angabe aus Strava
      else if (gear === "" || s.items.some((i) => i.id === gear)) s.assign[act] = String(gear);
      else return json({ ok: false, error: "Nicht gefunden." }, 404);
      break;
    }
    case "strava":
      try { return out(await syncStravaGear(env)); }
      catch (e) { return json({ ok: false, error: String((e as Error).message || e) }, 502); }
    default:
      return json({ ok: false, error: "Unbekannte Aktion." }, 400);
  }
  await saveStore(env, s);
  return out(s);
}
