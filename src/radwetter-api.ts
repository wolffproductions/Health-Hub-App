// Rad-Wetter-Planer (#153): Einstellungen, Orte und Vorhersage in kv, Abruf bei Open-Meteo, Mitteilungen im Cron.
// Rechnungen in radwetter.ts (rein, getestet). Datenschutz: Nur gespeicherte Orte gehen an Open-Meteo, auf 0,01° gerundet
// (etwa 1 km), bei Lieblingsrunden die Mitte der Runde statt des Starts. „Hier“ (aktueller Standort) nur nach Antippen und
// ohne Speichern. Alles bleibt privat: nicht für Freunde (#87), nicht für den Claude-Zugang (#5).
import type { Env } from "./env";
import { json, kvGetJson, kvPut, localDate } from "./util";
import {
  badges, bestWindow, challenge, cleanCrit, cleanWear, DEFAULT_CRIT, DEFAULT_WEAR, dryRuleText, fcUrl, feelOnBike, findWindows, fine,
  hours as toHours, itemRuleText, clauseText, learned, learnText, LEVELS, levelFor, localOf, logDays, mergeLog, nextWindow, packHours,
  parseForecast, pushMsg, pushPlan, rankRoutes, rateHours, records, roadFilm, routeInfo, streak, tzOffset, unpackHours, usedWindows,
  wardrobe, wearFor, windAdvice, winTime, dayWord, chillText, type Crit, type Fb, type Hour, type Log, type PushState, type RideAct,
  type WearCfg, type Win,
} from "./radwetter";
import { DEFAULT_CFG, sendAll, type PushCfg } from "./push";
import { kindOn } from "./mitteilungen";
import { localTime } from "./morgen";
import { mergeDuplicates } from "./strava/extract";
import { mergeWhoop } from "./whoop/extract";
import { mergeGoogle } from "./google/extract";
import type { Profile } from "./garmin/sync";

// ---------- Gespeichertes ----------
export interface Place {
  id: string; kind: "home" | "route"; name: string; lat: number; lng: number; // Wetter-Ort, auf 0,01° gerundet
  act?: string; km?: number; bear?: number; spread?: number; sk?: Array<[number, number]>; hi?: number; // nur Lieblingsrunden
}
export interface RwCfg {
  on: boolean; places: Place[]; crit: Crit; wear: WearCfg;
  game: boolean; goal: number;                                   // Dranbleiben anzeigen, Wochenziel (Fenster)
  push: { place: string | null; announce: boolean; remind: number }; // Mitteilungen (Art „wetter“ in pushCfg)
}
interface FcStore { at: number; key: string; demo?: boolean; list: Record<string, { tz: string; h: Record<string, unknown> }> }
interface FbStore { list: Array<Fb & { at?: number }>; resetAt?: number }

const MAX_ROUTES = 5;
const STALE = 2 * 3600e3; // Vorhersage höchstens alle 2 Stunden neu
const DISPLAY = 48;       // Stunden auf der Seite
export const DEFAULT_RW: RwCfg = { on: false, places: [], crit: DEFAULT_CRIT, wear: DEFAULT_WEAR, game: true, goal: 2, push: { place: null, announce: true, remind: 30 } };

export async function loadCfg(env: Env): Promise<RwCfg> {
  const c = await kvGetJson<Partial<RwCfg>>(env, "rwCfg", {});
  return {
    on: !!c.on, places: Array.isArray(c.places) ? c.places : [], crit: cleanCrit(c.crit), wear: cleanWear(c.wear),
    game: c.game !== false, goal: [1, 2, 3].includes(Number(c.goal)) ? Number(c.goal) : 2,
    push: { place: c.push?.place || null, announce: c.push?.announce !== false, remind: [0, 15, 30, 60].includes(Number(c.push?.remind)) ? Number(c.push?.remind) : 30 },
  };
}
const saveCfg = (env: Env, c: RwCfg) => kvPut(env, "rwCfg", JSON.stringify(c));
const placesKey = (ps: Place[]) => ps.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|");
const tzOf = async (env: Env) => (await kvGetJson<Profile | null>(env, "profile", null))?.tz || env.TIMEZONE || "Europe/Berlin";
/** Ort für Mitteilungen und das Protokoll: gewählt, sonst Zuhause, sonst der erste */
const mainPlace = (c: RwCfg) => c.places.find((p) => p.id === c.push.place) || c.places.find((p) => p.kind === "home") || c.places[0] || null;
/** Gelerntes Kälteempfinden aus den Rückmeldungen (nach dem letzten Zurücksetzen) */
const biasOf = (fb: FbStore) => learned(fb.list.filter((x) => !fb.resetAt || (x.at || 0) > fb.resetAt)).bias;

// ---------- Vorhersage holen ----------
async function fetchFc(points: Array<[number, number]>): Promise<unknown[]> {
  const res = await fetch(fcUrl(points), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error("Open-Meteo antwortet nicht (HTTP " + res.status + ")");
  const j = await res.json();
  return Array.isArray(j) ? j : [j];
}
/** Alle gespeicherten Orte in einer Anfrage holen, speichern und das Protokoll (Fenster je Tag) fortschreiben */
async function refresh(env: Env, cfg: RwCfg): Promise<FcStore> {
  const uniq: Array<[number, number]> = [];
  for (const p of cfg.places) if (!uniq.some((u) => u[0] === p.lat && u[1] === p.lng)) uniq.push([p.lat, p.lng]);
  const arr = await fetchFc(uniq);
  const list: FcStore["list"] = {};
  for (const p of cfg.places) {
    const fc = parseForecast(arr[uniq.findIndex((u) => u[0] === p.lat && u[1] === p.lng)]);
    if (fc) list[p.id] = { tz: fc.tz, h: packHours(fc.hours) };
  }
  if (!Object.keys(list).length) throw new Error("Open-Meteo hat keine brauchbare Vorhersage geliefert");
  const store: FcStore = { at: Date.now(), key: placesKey(cfg.places), list };
  await kvPut(env, "rwFc", JSON.stringify(store));
  await updateLog(env, cfg, store).catch((e) => console.error("radwetter log", e));
  return store;
}
const stale = (s: FcStore | null, cfg: RwCfg) => !s || s.key !== placesKey(cfg.places) || (!s.demo && Date.now() - s.at > STALE);
/** Vorhersage aus kv, bei Bedarf frisch (Fehler: alter Stand bleibt, Hinweis in err) */
async function forecast(env: Env, cfg: RwCfg, allowFetch: boolean): Promise<{ store: FcStore | null; err: string | null }> {
  let store = await kvGetJson<FcStore | null>(env, "rwFc", null);
  if (!cfg.on || !cfg.places.length) return { store: null, err: null };
  if (allowFetch && stale(store, cfg)) {
    try { store = await refresh(env, cfg); } catch (e) { return { store, err: (e as Error).message || "Open-Meteo nicht erreichbar" }; }
  }
  return { store, err: null };
}
/** Fenster je Tag für den Haupt-Ort merken (für „Fenster genutzt“, Serie und Rückmeldungen), höchstens 400 Tage */
async function updateLog(env: Env, cfg: RwCfg, store: FcStore) {
  const p = mainPlace(cfg); const pf = p && store.list[p.id];
  if (!pf) return;
  const hs = unpackHours(pf.h);
  const fresh = logDays(hs, findWindows(hs, rateHours(hs, cfg.crit), cfg.crit));
  await kvPut(env, "rwLog", JSON.stringify(mergeLog(await kvGetJson<Log>(env, "rwLog", {}), fresh)));
}

// ---------- Eigene Radfahrten (für Dranbleiben und Rückmeldungen) ----------
const RIDE = /cycl|biking|cyclocross|bike|_ride/, INDOOR = /virtual|indoor|trainer|spin/;
async function loadRides(env: Env): Promise<RideAct[]> {
  // Nur die Felder, die das Zusammenführen und die Auswertung brauchen (D1 liest sie aus dem JSON, das spart Rechenzeit im Worker)
  const f = (k: string) => `json_extract(data, '$.${k}') AS ${k}`;
  const { results } = await env.DB.prepare(
    `SELECT source, type, weather, ${["id", "date", "start", "km", "min", "minTotal", "name", "hidden", "trainer", "src"].map(f).join(", ")} FROM activities `
    + "WHERE type LIKE '%cycl%' OR type LIKE '%bik%' OR type LIKE '%ride%'",
  ).all<Record<string, any>>();
  const list: Array<Record<string, any>> = [];
  for (const r of results) {
    if (r.hidden) continue;
    const a: Record<string, any> = { id: r.id, date: r.date, start: r.start, type: r.type, km: r.km, min: r.min, minTotal: r.minTotal, name: r.name, trainer: r.trainer,
      src: r.source === "strava" || r.source === "whoop" || r.source === "google" ? r.source : r.src || "garmin" };
    try { if (r.weather && r.weather !== "{}") a.wx = JSON.parse(r.weather); } catch { /* kaputter Eintrag */ }
    list.push(a);
  }
  // Gleiche Fahrt aus mehreren Quellen nur einmal (wie /api/data)
  return mergeGoogle(mergeWhoop(mergeDuplicates(list)))
    .filter((a) => RIDE.test(a.type || "") && !INDOOR.test(a.type || "") && !a.trainer && a.date && a.start)
    .map((a) => ({ id: String(a.id), date: a.date, start: a.start, min: Number(a.min) || 0, km: Number(a.km) || 0, name: a.name || "", wx: a.wx || null }));
}

// ---------- Ansicht für die Oberfläche ----------
async function view(env: Env, cfg: RwCfg, url: URL) {
  const tzHome = await tzOf(env);
  const nowS = Math.floor(Date.now() / 1000);
  const fbStore = await kvGetJson<FbStore>(env, "rwFb", { list: [] });
  const bias = biasOf(fbStore);
  const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
  const here = url.searchParams.has("lat") && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  let err: string | null = null, tz = tzHome, hs: Hour[] = [], sel = "", place: (Place & { here?: boolean }) | null = null, at: number | null = null;
  let store: FcStore | null = null;
  if (cfg.on) {
    const f = await forecast(env, cfg, true);
    store = f.store; err = f.err; at = store?.at ?? null;
    if (here) {
      // Aktueller Standort: nur nach Antippen, gerundet, nicht gespeichert
      try {
        const fc = parseForecast((await fetchFc([[fine(lat), fine(lng)]]))[0]);
        if (fc) { hs = fc.hours; tz = fc.tz; sel = "hier"; at = Date.now(); place = { id: "hier", kind: "home", name: "Hier", lat: fine(lat), lng: fine(lng), here: true }; }
      } catch (e) { err = (e as Error).message; }
    }
    if (!place) {
      const want = url.searchParams.get("place");
      place = cfg.places.find((p) => p.id === want) || mainPlace(cfg);
      const pf = place && store?.list[place.id];
      if (place && pf) { hs = unpackHours(pf.h); tz = pf.tz; sel = place.id; }
    }
  }
  const today = localDate(tz);
  const dur = Math.max(30, Math.min(480, Math.round((Number(url.searchParams.get("dur")) || cfg.wear.dur) / 30) * 30));
  const out: Record<string, unknown> = {
    on: cfg.on, at, err, tz, now: nowS, today, sel, dur, bias,
    cfg: settingsOut(cfg, fbStore),
    places: [] as unknown[],
    attribution: { text: "Wetterdaten: Open-Meteo.com (CC BY 4.0)", url: "https://open-meteo.com/" },
    dryRule: dryRuleText(cfg.crit.wait), chillRule: chillText(cfg.wear.speed),
  };
  // Übersicht aller Orte mit ihrem nächsten Fenster (für die Auswahl oben)
  for (const p of cfg.places) {
    const pf = store?.list[p.id];
    let next: Win | null = null;
    if (pf) { const h = unpackHours(pf.h); next = nextWindow(findWindows(h, rateHours(h, cfg.crit), cfg.crit), nowS); }
    (out.places as unknown[]).push({ id: p.id, kind: p.kind, name: p.name, km: p.km ?? null, sk: p.sk || null, hi: p.hi ?? null, bear: p.bear ?? null, spread: p.spread ?? null, next: next && winOut(next, today) });
  }
  if (hs.length && place) {
    const rated = rateHours(hs, cfg.crit), film = roadFilm(hs, cfg.crit.wait);
    const wins = findWindows(hs, rated, cfg.crit);
    // Ab der laufenden Stunde 48 Stunden
    let i0 = hs.findIndex((h) => h.e + 3600 > nowS); if (i0 < 0) i0 = hs.length;
    const show = hs.slice(i0, i0 + DISPLAY);
    out.place = { id: place.id, name: place.name, kind: place.kind, here: !!place.here, km: place.km ?? null, sk: place.sk || null, hi: place.hi ?? null, bear: place.bear ?? null, spread: place.spread ?? null };
    out.hours = show.map((h, k) => {
      const r = rated[i0 + k];
      return { e: h.e, d: h.d, h: h.h, wd: h.wd, t: h.t, ta: h.ta, p: h.p, pp: h.pp, c: h.c, ws: h.ws, wg: h.wg, wdir: h.wdir, sun: h.sun, light: h.light,
        st: r.st, off: r.off, why: r.why, road: r.road, sc: r.score, f: feelOnBike(h, cfg.wear.speed, bias) };
    });
    const vis = wins.filter((w) => w.e > nowS && w.s < nowS + DISPLAY * 3600);
    out.wins = vis.map((w) => winOut(w, today, i0));
    const next = nextWindow(wins, nowS), best = bestWindow(wins, nowS);
    out.next = next && winOut(next, today, i0);
    out.best = best && winOut(best, today, i0);
    if (!next) out.near = nearMiss(show, rated.slice(i0, i0 + DISPLAY), cfg.crit, today);
    // Wind: für das nächste (sonst das aktuelle) Fenster, Lieblingsrunden danach geordnet
    const focus = next || null;
    const wm = focus ? { dir: focus.wdir, ws: focus.ws } : { dir: show[0]?.wdir ?? 0, ws: show[0]?.ws ?? 0 };
    const routes = cfg.places.filter((p) => p.kind === "route" && p.bear != null && p.spread != null) as Array<Place & { bear: number; spread: number; km: number }>;
    out.wind = { dir: wm.dir, ws: wm.ws, wg: focus ? focus.wg : show[0]?.wg ?? 0, forWin: !!focus,
      advice: windAdvice(wm.dir, wm.ws, place.kind === "route" && place.bear != null ? { bear: place.bear, spread: place.spread ?? 0 } : null),
      free: windAdvice(wm.dir, wm.ws, null) };
    out.routes = rankRoutes(routes.map((r) => ({ id: r.id, name: r.name, km: r.km || 0, bear: r.bear, spread: r.spread, sk: r.sk || null, hi: r.hi ?? null })), wm, focus ? focus.n : 3, cfg.wear.speed);
    // Kleidung für einen Start in jeder angezeigten Stunde (die Seite wechselt ohne neue Anfrage)
    const wearCfg = cfg.wear;
    out.wear = show.map((_, k) => {
      const w = wearFor(hs, film, i0 + k, dur, wearCfg, bias);
      if (!w) return null;
      const r = w.ride;
      return { lvl: w.lvl, name: w.name, desc: w.desc, why: w.why, items: w.items, parts: w.parts,
        f: { min: r.fMin, max: r.fMax, start: r.fStart, end: r.fEnd, avg: r.fAvg }, t: r.t, ta: r.ta, chill: r.chill, ws: r.ws, wg: r.wg, rain: r.rain, wet: r.wet, dark: r.dark };
    });
    out.wearStart = next && next.i >= i0 ? next.i - i0 : 0;
  }
  // Dranbleiben und Rückmeldungen: nur aus eigenen Daten, privat
  const rides = await loadRides(env);
  const log = await kvGetJson<Log>(env, "rwLog", {});
  const used = usedWindows(rides, log);
  const nowLocal = localOf(nowS, safeOffset(tz, nowS));
  out.fb = feedbackOut(rides, fbStore, today);
  if (cfg.game) {
    out.game = {
      since: Object.keys(log).sort()[0] || null,
      used: used.length,
      week: challenge(log, used, today, cfg.goal, nowLocal.h + new Date(nowS * 1000).getUTCMinutes() / 60),
      streak: streak(log, used, today),
      badges: badges(rides, used, log, fbStore.list, today),
      records: records(rides),
      wardrobe: wardrobe(fbStore.list),
      wx: rides.some((r) => r.wx),
      rides: rides.length,
    };
  }
  return out;
}
const safeOffset = (tz: string, e: number) => { try { return tzOffset(tz, e); } catch { return 0; } };
function winOut(w: Win, today: string, i0 = 0) {
  return { ...w, k: w.i - i0, day: dayWord(w.d, today), time: winTime(w) };
}
/** Kein Fenster: der Abschnitt, der am wenigsten verfehlt (knapp gegen klar schlecht) */
function nearMiss(hs: Hour[], rated: ReturnType<typeof rateHours>, crit: Crit, today: string) {
  let best: { k: number; n: number; sc: number } | null = null;
  for (let k = 0; k < hs.length; k++) {
    if (rated[k].off || rated[k].st === "bad") continue;
    let j = k;
    while (j + 1 < hs.length && !rated[j + 1].off && rated[j + 1].st !== "bad") j++;
    const n = j - k + 1, sc = rated.slice(k, j + 1).reduce((s, r) => s + r.score, 0) / n + Math.min(n, crit.minH) * 5;
    if (!best || sc > best.sc) best = { k, n, sc };
    k = j;
  }
  if (!best) return null;
  const part = hs.slice(best.k, best.k + best.n), why = [...new Set(rated.slice(best.k, best.k + best.n).flatMap((r) => r.why))];
  return { k: best.k, n: best.n, d: part[0].d, day: dayWord(part[0].d, today), time: winTime({ h0: part[0].h, h1: part[part.length - 1].h + 1 }), why };
}
function settingsOut(cfg: RwCfg, fb: FbStore) {
  const l = learned(fb.list.filter((x) => !fb.resetAt || (x.at || 0) > fb.resetAt));
  return {
    on: cfg.on, crit: cfg.crit, game: cfg.game, goal: cfg.goal, push: cfg.push,
    places: cfg.places.map((p) => ({ id: p.id, kind: p.kind, name: p.name, km: p.km ?? null, sk: p.sk || null, hi: p.hi ?? null, bear: p.bear ?? null })),
    wear: { ...cfg.wear, items: cfg.wear.items.map((it) => ({ ...it, text: itemRuleText(it), texts: it.rules.map(clauseText) })) },
    levels: LEVELS, learn: { bias: l.bias, text: learnText(l.bias), moves: l.moves.slice(-8).reverse() },
  };
}
/** Fahrten der letzten 4 Tage ohne Rückmeldung (höchstens 2) und die letzten Rückmeldungen */
function feedbackOut(rides: RideAct[], fb: FbStore, today: string) {
  const from = new Date(Date.parse(today + "T12:00:00Z") - 3 * 864e5).toISOString().slice(0, 10);
  const done = new Set(fb.list.map((x) => x.id));
  const pending = rides.filter((r) => r.date >= from && r.date <= today && !done.has(r.id)).sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1)).slice(0, 2);
  return { pending: pending.map((r) => ({ id: r.id, date: r.date, start: r.start, km: r.km, name: r.name })), recent: [...fb.list].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 6) };
}

/**
 * Kurzfassung für „Heute“ und „Einheiten“: nächstes Fenster des Haupt-Orts, Überblick der 48 Stunden, Wochenziel und
 * offene Rückmeldungen. Ohne Abruf bei Open-Meteo (das macht der Cron), damit „Heute“ schnell bleibt.
 */
async function short(env: Env, cfg: RwCfg) {
  if (!cfg.on || !cfg.places.length) return { on: false };
  const { store } = await forecast(env, cfg, false);
  const place = mainPlace(cfg), pf = place && store?.list[place.id];
  const nowS = Math.floor(Date.now() / 1000);
  const fbStore = await kvGetJson<FbStore>(env, "rwFb", { list: [] });
  const rides = await loadRides(env);
  const out: Record<string, unknown> = { on: true, sel: place?.id || null, place: cfg.places.length > 1 ? place?.name : null, at: store?.at ?? null };
  const tz = pf?.tz || (await tzOf(env)), today = localDate(tz);
  out.fbPending = (feedbackOut(rides, fbStore, today).pending).map((x) => x.id);
  if (!pf) return out;
  const hs = unpackHours(pf.h), rated = rateHours(hs, cfg.crit), wins = findWindows(hs, rated, cfg.crit);
  let i0 = hs.findIndex((h) => h.e + 3600 > nowS); if (i0 < 0) i0 = hs.length;
  const next = nextWindow(wins, nowS);
  out.next = next && winOut(next, today, i0);
  if (next) {
    const w = wearFor(hs, roadFilm(hs, cfg.crit.wait), next.i, Math.min(cfg.wear.dur, next.n * 60), cfg.wear, biasOf(fbStore));
    out.wear = w ? [w.name, ...w.items.filter((x) => x.part).map((x) => x.name)].join(", ") : null;
  }
  out.band = rated.slice(i0, i0 + DISPLAY).map((r) => (r.off ? "off" : r.st));
  if (cfg.game) {
    const log = await kvGetJson<Log>(env, "rwLog", {});
    const used = usedWindows(rides, log);
    const loc = localOf(nowS, safeOffset(tz, nowS));
    out.week = challenge(log, used, today, cfg.goal, loc.h);
    out.streak = streak(log, used, today).cur;
  }
  return out;
}

// ---------- Rückmeldung speichern ----------
async function saveFeedback(env: Env, cfg: RwCfg, id: string, v: number) {
  const rides = await loadRides(env);
  const r = rides.find((x) => x.id === id);
  if (!r) return { ok: false, error: "Diese Fahrt kennt die App nicht." };
  const fb = await kvGetJson<FbStore>(env, "rwFb", { list: [] });
  // Gefühlt auf dem Rad zur Fahrt: Wetter je Einheit (#54), sonst die gemerkten Stunden des Haupt-Orts
  const log = await kvGetJson<Log>(env, "rwLog", {});
  const h = Math.floor(toHours(r.start) + (r.min || 60) / 120) % 24;
  const day = log[r.date];
  const t = r.wx && typeof r.wx.t === "number" ? r.wx.t : day?.t?.[h] ?? null;
  const ta = r.wx && typeof r.wx.ta === "number" ? r.wx.ta : day?.ta?.[h] ?? null;
  const bias = biasOf(fb);
  const f = t != null && ta != null ? feelOnBike({ t, ta }, cfg.wear.speed, bias) : null;
  const entry = { id, d: r.date, v: (v < 0 ? -1 : v > 0 ? 1 : 0) as -1 | 0 | 1, f, lvl: f != null ? levelFor(f, cfg.wear.lv) : null, at: Date.now() };
  fb.list = [...fb.list.filter((x) => x.id !== id), entry].slice(-200);
  await kvPut(env, "rwFb", JSON.stringify(fb));
  return { ok: true };
}

// ---------- Orte ----------
const newId = () => "r" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const cleanName = (s: unknown, d: string) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || d;
/** Häufigster Start der eigenen Fahrten (Zelle 0,01°): Vorschlag für „Zuhause“ */
async function homeFromRides(env: Env): Promise<[number, number] | null> {
  const { results } = await env.DB.prepare(
    "SELECT json_extract(route, '$[0]') AS p0 FROM activities WHERE route IS NOT NULL AND route <> '[]' AND (type LIKE '%cycl%' OR type LIKE '%bik%' OR type LIKE '%ride%') ORDER BY day DESC LIMIT 300",
  ).all<{ p0: string | null }>();
  const count = new Map<string, number>();
  for (const r of results) {
    try { const p = JSON.parse(r.p0 || "null") as number[]; if (p && isFinite(p[0]) && isFinite(p[1])) { const k = fine(p[0]) + "," + fine(p[1]); count.set(k, (count.get(k) || 0) + 1); } } catch { /* überspringen */ }
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best ? (best[0].split(",").map(Number) as [number, number]) : null;
}
async function addRoute(env: Env, cfg: RwCfg, act: string, name: unknown) {
  if (cfg.places.filter((p) => p.kind === "route").length >= MAX_ROUTES) return { ok: false, error: `Höchstens ${MAX_ROUTES} Lieblingsrunden.` };
  const row = await env.DB.prepare("SELECT route, data FROM activities WHERE external_id = ? AND route IS NOT NULL AND route <> '[]' LIMIT 1").bind(act).first<{ route: string; data: string }>();
  if (!row) return { ok: false, error: "Zu dieser Fahrt gibt es keine Strecke." };
  const info = routeInfo(JSON.parse(row.route));
  if (!info) return { ok: false, error: "Die Strecke ist zu kurz." };
  const a = JSON.parse(row.data || "{}");
  const def = a.name || `Runde vom ${String(a.date || "").slice(8, 10)}.${String(a.date || "").slice(5, 7)}.`;
  cfg.places.push({ id: newId(), kind: "route", name: cleanName(name, def), lat: info.c[0], lng: info.c[1], act, km: info.km, bear: info.bear, spread: info.spread, sk: info.sk, hi: info.hi });
  return { ok: true };
}

/** Ortssuche über Open-Meteo Geocoding (nur der eingegebene Name geht hinaus) */
async function search(q: string) {
  const u = "https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({ name: q.slice(0, 60), count: "6", language: "de", format: "json" });
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const j = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (j.results || []).map((r) => ({ name: String(r.name || ""), area: [r.admin1, r.country].filter(Boolean).join(", "), lat: fine(Number(r.latitude)), lng: fine(Number(r.longitude)) }))
    .filter((r) => r.name && isFinite(r.lat) && isFinite(r.lng));
}

// ---------- Route /api/radwetter ----------
export async function radwetterRoute(req: Request, url: URL, env: Env, sub: string) {
  const cfg = await loadCfg(env);
  if (sub === "suche") return json({ results: url.searchParams.get("q") ? await search(String(url.searchParams.get("q"))) : [] });
  if (sub === "kurz") return json(await short(env, cfg));
  if (sub === "einstellungen") return json({ cfg: settingsOut(cfg, await kvGetJson<FbStore>(env, "rwFb", { list: [] })) });
  if (req.method === "GET") return json(await view(env, cfg, url));
  if (req.method !== "POST") return json({ error: "Nicht erlaubt" }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  let res: { ok: boolean; error?: string } = { ok: true };
  switch (b.action) {
    case "on": cfg.on = b.on === true; break;
    case "home": {
      let p: [number, number] | null = null;
      if (b.from === "rides") { p = await homeFromRides(env); if (!p) { res = { ok: false, error: "In deinen Fahrten ist noch keine Strecke mit GPS." }; break; } }
      else if (isFinite(Number(b.lat)) && isFinite(Number(b.lng)) && Math.abs(Number(b.lat)) <= 90 && Math.abs(Number(b.lng)) <= 180) p = [fine(Number(b.lat)), fine(Number(b.lng))];
      if (!p) { res = { ok: false, error: "Ort ungültig." }; break; }
      const old = cfg.places.find((x) => x.kind === "home");
      const home: Place = { id: "home", kind: "home", name: cleanName(b.name, old?.name || "Zuhause"), lat: p[0], lng: p[1] };
      cfg.places = [home, ...cfg.places.filter((x) => x.kind !== "home")];
      cfg.on = true;
      break;
    }
    case "route-add": res = await addRoute(env, cfg, String(b.act || ""), b.name); if (res.ok) cfg.on = true; break;
    case "place-del": cfg.places = cfg.places.filter((p) => p.id !== b.id); if (cfg.push.place === b.id) cfg.push.place = null; break;
    case "place-name": { const p = cfg.places.find((x) => x.id === b.id); if (p) p.name = cleanName(b.name, p.name); break; }
    case "crit": cfg.crit = cleanCrit({ ...cfg.crit, ...(b.crit || {}) }); break;
    case "crit-reset": cfg.crit = cleanCrit(null); break;
    case "wear": cfg.wear = cleanWear({ ...cfg.wear, ...(b.wear || {}) }); break;
    case "wear-reset": cfg.wear = cleanWear(null); break;
    case "game": if (typeof b.game === "boolean") cfg.game = b.game; if ([1, 2, 3].includes(Number(b.goal))) cfg.goal = Number(b.goal); break;
    case "push":
      if (typeof b.announce === "boolean") cfg.push.announce = b.announce;
      if ([0, 15, 30, 60].includes(Number(b.remind))) cfg.push.remind = Number(b.remind);
      if (b.place === null || cfg.places.some((p) => p.id === b.place)) cfg.push.place = b.place;
      break;
    case "fb": return json(await saveFeedback(env, cfg, String(b.id || ""), Number(b.v)));
    case "learn-reset": {
      const fb = await kvGetJson<FbStore>(env, "rwFb", { list: [] });
      fb.resetAt = Date.now();
      await kvPut(env, "rwFb", JSON.stringify(fb));
      return json({ ok: true });
    }
    default: return json({ ok: false, error: "Unbekannte Aktion." }, 400);
  }
  if (!res.ok) return json(res, 400);
  await saveCfg(env, cfg);
  return json({ ok: true, cfg: settingsOut(cfg, await kvGetJson<FbStore>(env, "rwFb", { list: [] })) });
}

/** Für Konto → Benachrichtigungen: Ankündigen/Erinnern und ob es überhaupt Orte gibt */
export async function radwetterPushInfo(env: Env) {
  const c = await loadCfg(env);
  return { on: c.on && c.places.length > 0, ...c.push, places: c.places.map((p) => ({ id: p.id, name: p.name })) };
}

// ---------- Cron: Vorhersage auffrischen und Mitteilungen ----------
/**
 * Läuft bei jedem Cron-Aufruf (alle 10 Minuten). Die Vorhersage holt er nur bei :10 und :40 (eigener Aufruf, eigenes
 * Anfrage-Kontingent) und nur, wenn sie älter als 2 Stunden ist; Erinnerungen prüft er jedes Mal (ohne Abruf).
 */
export async function radwetterTick(env: Env, minute: number) {
  const cfg = await loadCfg(env);
  if (!cfg.on || !cfg.places.length) return;
  const { store } = await forecast(env, cfg, minute % 30 === 10);
  const place = mainPlace(cfg), pf = place && store?.list[place.id];
  if (!place || !pf) return;
  const pushCfg: PushCfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  if (!kindOn(pushCfg, "wetter")) return;
  const hs = unpackHours(pf.h), tz = pf.tz;
  const wins = findWindows(hs, rateHours(hs, cfg.crit), cfg.crit);
  const nowS = Math.floor(Date.now() / 1000), today = localDate(tz);
  const st = await kvGetJson<PushState>(env, "rwPush", {});
  const plan = pushPlan(wins, st, nowS, localTime(tz), today, cfg.push);
  if (!plan.kind) {
    if (JSON.stringify(plan.state) !== JSON.stringify(st)) await kvPut(env, "rwPush", JSON.stringify(plan.state));
    return;
  }
  const fb = await kvGetJson<FbStore>(env, "rwFb", { list: [] });
  const w = plan.win;
  const wear = w ? wearFor(hs, roadFilm(hs, cfg.crit.wait), w.i, Math.min(cfg.wear.dur, w.n * 60), cfg.wear, biasOf(fb)) : null;
  const advice = w ? windAdvice(w.wdir, w.ws, place.kind === "route" && place.bear != null ? { bear: place.bear, spread: place.spread ?? 0 } : null) : null;
  const oldText = plan.old ? (() => { const a = localOf(plan.old![0], safeOffset(tz, plan.old![0])), b = localOf(plan.old![1], safeOffset(tz, plan.old![1])); return `${dayWord(a.d, today)} ${winTime({ h0: a.h, h1: b.h || 24 })}`; })() : undefined;
  const msg = pushMsg(plan.kind, { today, now: nowS, win: w, old: plan.old, oldText, wear, advice, place: cfg.places.length > 1 ? place.name : undefined });
  const res = await sendAll(env, { ...msg, url: "/#radwetter/" + place.id, tag: "wetter" }, pushCfg.origin || "mailto:health-hub@localhost");
  // Nur merken, wenn es ankam; sonst beim nächsten Lauf noch einmal
  if (res.ok) await kvPut(env, "rwPush", JSON.stringify(plan.state));
}
