// Garmin-Antworten -> Tageswerte und Trainings.
// Feldnamen gegen die echte Personal API getestet (Eddies Version); dahinter stehen Ausweich-Pfade
// für ältere Garmin-Connect-Formate. Reine Funktionen, getestet in test/extract.test.ts.
//
// Metriken und Einheiten (zugleich die Feldnamen in der Oberfläche):
//   rhr bpm · stress/stressMax 0–100 · stRest/stLow/stMed/stHi min (Zeit je Stressstufe)
//   bbMax/bbMin 0–100 · bbNow aktueller Stand 0–100 · bbWake beim Aufwachen 0–100
//   bbCharged/bbDrained Punkte · steps · vig/mod min
//   slp/deep/rem h · awake min · score 0–100 · shr bpm · resp Atemzüge/min · bed/wake Uhrzeit in h (bed > 24 = nach Mitternacht)
//   spo2/spo2Lo % (Sauerstoffsättigung im Schlaf, Ø und Tiefstwert)
//   hrv/hrvWk/hrvLo/hrvHi ms · kg · fat % · fitAge/fitAgeAch Jahre (Fitnessalter, erreichbar)

export interface MetricRow { day: string; metric: string; value: number }

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const round = (x: unknown, n = 1): number | null =>
  typeof x === "number" && isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null;

/** Liste aus einer Antwort: Array, {data|results|items:[...]}, oder erstes Array-Feld. */
export function toList(json: unknown): Obj[] {
  if (Array.isArray(json)) return json.filter(isObj);
  if (!isObj(json)) return [];
  for (const k of ["data", "results", "items"]) if (Array.isArray(json[k])) return json[k].filter(isObj);
  for (const v of Object.values(json)) if (Array.isArray(v) && v.length && isObj(v[0])) return v.filter(isObj);
  return [];
}

function at(o: Obj, path: string): unknown {
  let cur: unknown = o;
  for (const p of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}
/** Erster gültiger Zahlenwert unter den Pfaden. */
export function pick(o: Obj, ...paths: string[]): number | null {
  for (const p of paths) {
    const v = at(o, p);
    if (typeof v === "number" && isFinite(v)) return v;
  }
  return null;
}
const dayOf = (o: Obj): string | null => {
  const s = at(o, "calendarDate") ?? at(o, "date") ?? at(o, "dailySleepDTO.calendarDate");
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

function push(rows: MetricRow[], day: string, metric: string, v: number | null) {
  if (v != null && isFinite(v)) rows.push({ day, metric, value: v });
}

export function extractDailySummaries(json: unknown): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const x of toList(json)) {
    const d = dayOf(x);
    if (!d) continue;
    push(rows, d, "rhr", pick(x, "heartRate.restingValue", "restingHeartRate"));
    const stress = pick(x, "stress.avgLevel", "averageStressLevel");
    if (stress != null && stress >= 0) push(rows, d, "stress", stress); // -1/-2 = zu wenig Daten
    const smax = pick(x, "stress.maxLevel", "maxStressLevel");
    if (smax != null && smax >= 0) push(rows, d, "stressMax", smax);
    // Zeit je Stressstufe in Sekunden → Minuten. Feldnamen der Personal API noch ungetestet, daher Ausweich-Pfade
    const mins = (...p: string[]) => { const v = pick(x, ...p); return v != null && v >= 0 ? round(v / 60, 0) : null; };
    push(rows, d, "stRest", mins("stress.restDuration", "stress.restStressDuration", "restStressDuration"));
    push(rows, d, "stLow", mins("stress.lowDuration", "stress.lowStressDuration", "lowStressDuration"));
    push(rows, d, "stMed", mins("stress.mediumDuration", "stress.mediumStressDuration", "mediumStressDuration"));
    push(rows, d, "stHi", mins("stress.highDuration", "stress.highStressDuration", "highStressDuration"));
    push(rows, d, "bbCharged", pick(x, "bodyBattery.chargedValue", "bodyBattery.charged", "bodyBatteryChargedValue"));
    push(rows, d, "bbDrained", pick(x, "bodyBattery.drainedValue", "bodyBattery.drained", "bodyBatteryDrainedValue"));
    push(rows, d, "bbMax", pick(x, "bodyBattery.maxValue", "bodyBatteryHighestValue"));
    push(rows, d, "bbMin", pick(x, "bodyBattery.minValue", "bodyBatteryLowestValue"));
    push(rows, d, "bbNow", pick(x, "bodyBattery.latestValue", "bodyBatteryMostRecentValue"));
    push(rows, d, "bbWake", pick(x, "bodyBattery.atWakeTimeValue", "bodyBatteryAtWakeTime"));
    push(rows, d, "steps", pick(x, "movement.steps.value", "totalSteps"));
    push(rows, d, "vig", pick(x, "intensityMinutes.vigorous", "vigorousIntensityMinutes"));
    push(rows, d, "mod", pick(x, "intensityMinutes.moderate", "moderateIntensityMinutes"));
  }
  return rows;
}

/** Garmin liefert lokale Zeitstempel als ms "UTC-kodiert": UTC-Stunden = lokale Uhrzeit. */
/** Body-Battery-Verlauf eines Tages: [Minute seit Mitternacht (Ortszeit), Stand 0–100] */
export interface BbCurve { day: string; pts: Array<[number, number]> }

/**
 * Tagesverlauf aus `wellness-service/wellness/bodyBattery/reports/daily`. Jede Zeile in
 * `bodyBatteryValuesArray` ist laut `bodyBatteryValueDescriptorDTOList` aufgebaut (timestamp,
 * bodyBatteryLevel, …). Der Zeitstempel ist UTC in ms; die Verschiebung zur Ortszeit ergibt sich
 * aus startTimestampLocal minus startTimestampGMT.
 */
export function extractBodyBatteryCurves(json: unknown): BbCurve[] {
  const out: BbCurve[] = [];
  for (const r of toList(json)) {
    const day = typeof r.date === "string" ? r.date.slice(0, 10) : typeof r.calendarDate === "string" ? r.calendarDate.slice(0, 10) : null;
    const rows = r.bodyBatteryValuesArray;
    if (!day || !Array.isArray(rows)) continue;
    const idx: Record<string, number> = { timestamp: 0, bodyBatteryLevel: 1 };
    for (const dsc of Array.isArray(r.bodyBatteryValueDescriptorDTOList) ? r.bodyBatteryValueDescriptorDTOList : []) {
      if (typeof dsc?.bodyBatteryValueDescriptorKey === "string" && typeof dsc.bodyBatteryValueDescriptorIndex === "number") {
        idx[dsc.bodyBatteryValueDescriptorKey] = dsc.bodyBatteryValueDescriptorIndex;
      }
    }
    const lo = Date.parse(r.startTimestampLocal), gmt = Date.parse(r.startTimestampGMT);
    const offset = Number.isFinite(lo) && Number.isFinite(gmt) ? lo - gmt : 0;
    const midnight = Date.parse(day + "T00:00:00Z");
    const pts: Array<[number, number]> = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const ts = Number(row[idx.timestamp]), lvl = row[idx.bodyBatteryLevel];
      if (!Number.isFinite(ts) || typeof lvl !== "number" || lvl < 0 || lvl > 100) continue;
      const m = Math.round((ts + offset - midnight) / 60000);
      if (m >= 0 && m < 1440) pts.push([m, lvl]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length) out.push({ day, pts });
  }
  return out;
}

export function clockHours(ms: unknown, wrap: boolean): number | null {
  if (ms == null || !isFinite(Number(ms))) return null;
  const d = new Date(Number(ms));
  let h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (wrap && h < 12) h += 24;
  return round(h, 2);
}

export function extractSleep(json: unknown): MetricRow[] {
  const rows: MetricRow[] = [];
  const list = Array.isArray(json) ? json.filter(isObj) : isObj(json) && json.dailySleepDTO ? [json.dailySleepDTO] : toList(json);
  for (const s of list) {
    const d = dayOf(s);
    const secs = pick(s, "sleepTimeSeconds");
    if (!d || !secs) continue;
    const h = (v: number | null) => (v == null ? null : round(v / 3600, 2));
    push(rows, d, "slp", h(secs));
    push(rows, d, "deep", h(pick(s, "deepSleepSeconds")));
    push(rows, d, "rem", h(pick(s, "remSleepSeconds")));
    const awake = pick(s, "awakeSleepSeconds");
    push(rows, d, "awake", awake == null ? null : round(awake / 60, 0));
    push(rows, d, "score", pick(s, "sleepScores.overall.value", "overallSleepScore.value"));
    // Puls im Schlaf: avgHeartRate ist in der Personal API leer (getestet: 0 von 343 Nächten).
    // averageSpO2HRSleep = Ø-Puls während der nächtlichen SpO2-Messung, bei aktiver Pulsoximetrie meist gefüllt.
    push(rows, d, "shr", pick(s, "avgHeartRate", "averageHeartRate", "averageSpO2HRSleep"));
    push(rows, d, "spo2", pick(s, "averageSpO2Value"));
    push(rows, d, "spo2Lo", pick(s, "lowestSpO2Value"));
    push(rows, d, "resp", pick(s, "averageRespirationValue"));
    push(rows, d, "bed", clockHours(s.sleepStartTimestampLocal, true));
    push(rows, d, "wake", clockHours(s.sleepEndTimestampLocal, false));
  }
  return rows;
}

export function extractHrv(json: unknown): MetricRow[] {
  const rows: MetricRow[] = [];
  const list = isObj(json) && Array.isArray(json.hrvSummaries) ? json.hrvSummaries : toList(json);
  for (const h of list) {
    const d = dayOf(h);
    if (!d) continue;
    push(rows, d, "hrv", pick(h, "lastNightAvg"));
    push(rows, d, "hrvWk", pick(h, "weeklyAvg"));
    push(rows, d, "hrvLo", pick(h, "baseline.balancedLow"));
    push(rows, d, "hrvHi", pick(h, "baseline.balancedUpper"));
  }
  return rows;
}

/** Gewicht: noch nicht gegen die Personal API getestet. Garmin speichert Gramm. */
export function extractWeight(json: unknown): MetricRow[] {
  const byKey = new Map<string, MetricRow>();
  const list = isObj(json) && Array.isArray(json.dateWeightList) ? json.dateWeightList : toList(json);
  for (const w of list) {
    const d = dayOf(w);
    if (!d) continue;
    const g = pick(w, "weight");
    if (g != null && g > 1000) byKey.set(d + "|kg", { day: d, metric: "kg", value: round(g / 1000, 2)! });
    const fat = pick(w, "bodyFat");
    if (fat != null) byKey.set(d + "|fat", { day: d, metric: "fat", value: fat });
  }
  return [...byKey.values()];
}

/** Ein Training im Format der Oberfläche. */
export function normalizeActivity(a: Obj): Obj | null {
  if (a.activityId == null || typeof a.startTimeLocal !== "string") return null;
  return {
    id: String(a.activityId),
    date: a.startTimeLocal.slice(0, 10),
    start: a.startTimeLocal.slice(11, 16),
    type: a.activityType?.typeKey || "other",
    name: a.activityName || "",
    km: round((a.distance || 0) / 1000, 2),
    min: round((a.duration || 0) / 60, 1),
    hr: a.averageHR ?? null,
    maxHr: a.maxHR ?? null,
    spd: round(a.averageSpeed, 3),
    gap: round(a.avgGradeAdjustedSpeed, 3),
    cad: round(a.averageRunningCadenceInStepsPerMinute, 1),
    gct: round(a.avgGroundContactTime, 1),
    vo: round(a.avgVerticalOscillation, 2),
    pw: a.avgPower ?? null,
    np: a.normPower ?? null,
    elev: round(a.elevationGain, 0),
    te: round(a.aerobicTrainingEffect, 1),
    teAn: round(a.anaerobicTrainingEffect, 1),
    load: round(a.activityTrainingLoad, 1),
    label: a.trainingEffectLabel || null,
    z: [1, 2, 3, 4, 5].map((i) => round(a["hrTimeInZone_" + i], 0) || 0),
    f5k: round(a.fastestSplit_5000, 0),
    f10k: round(a.fastestSplit_10000, 0),
    fHm: round(a.fastestSplit_21098, 0),
    fM: round(a.fastestSplit_42195, 0),
    // VO2max laut Garmin zum Zeitpunkt der Einheit (Lauf bzw. Rad), fehlt bei anderen Sportarten
    vo2: round(a.vO2MaxValue, 1),
    // Kalorien laut Garmin (aktive + Grundumsatz während der Einheit), kcal (#17)
    kcal: round(a.calories, 0),
  };
}

// ---------- Runden und Route aus der Originaldatei (.fit im .zip) ----------
// Die Personal API liefert Runden und GPS-Spur nicht direkt, wohl aber die FIT-Datei der Uhr.
// Gelesen werden nur Runden (FIT-Nachricht 19) und Messpunkte (Nachricht 20), alles andere wird übersprungen.

export async function unzipFirst(buf: ArrayBuffer): Promise<Uint8Array> {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("kein ZIP");
  const cd = dv.getUint32(e + 16, true);
  const method = dv.getUint16(cd + 10, true), csize = dv.getUint32(cd + 20, true), lh = dv.getUint32(cd + 42, true);
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const data = b.subarray(start, start + csize);
  if (method === 0) return data;
  if (method !== 8) throw new Error("ZIP-Methode " + method);
  const out = new Response(new Response(data).body!.pipeThrough(new DecompressionStream("deflate-raw")));
  return new Uint8Array(await out.arrayBuffer());
}

/** Runde: Ø Puls, Geschwindigkeit (m/s), Dauer (s), Länge (m) */
export interface Lap { hr: number | null; v: number | null; s: number | null; m: number | null }
/** Route als [Breite, Länge] in Grad, auf 5 Nachkommastellen (~1 m) gerundet */
export type Route = Array<[number, number]>;

/** Höchste Abweichung der vereinfachten Route von der GPS-Spur in Metern */
export const ROUTE_TOLERANCE_M = 2.5;
/** Obergrenze der gespeicherten Routenpunkte (reicht auch für sehr lange, kurvige Strecken) */
export const ROUTE_MAX_POINTS = 1500;

type FitMsg = Record<number, number | null>;

/**
 * Liest aus einer FIT-Datei die Felder `want[global][]` der gewünschten Nachrichten.
 * Ein Durchgang über die Datei; nicht gewünschte Nachrichten werden nur übersprungen.
 */
export function fitScan(u8: Uint8Array, want: Record<number, number[]>): Record<number, FitMsg[]> {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hs = u8[0];
  const end = Math.min(u8.length, hs + dv.getUint32(4, true));
  const defs: Array<{ g: number; le: boolean; fields: Array<{ n: number; s: number; o: number; b: number }>; len: number }> = [];
  const out: Record<number, FitMsg[]> = {};
  for (const g of Object.keys(want)) out[Number(g)] = [];
  // Basistypen 0x01/0x83/0x85 sind vorzeichenbehaftet (z. B. GPS-Koordinaten)
  const rd = (o: number, size: number, le: boolean, b: number) => {
    const signed = b === 0x01 || b === 0x83 || b === 0x85;
    if (size === 1) return signed ? dv.getInt8(o) : dv.getUint8(o);
    if (size === 2) return signed ? dv.getInt16(o, le) : dv.getUint16(o, le);
    if (size === 4) return signed ? dv.getInt32(o, le) : dv.getUint32(o, le);
    return null;
  };
  let p = hs;
  while (p < end) {
    const h = u8[p++];
    if (h & 0x80) { const d = defs[(h >> 5) & 3]; if (!d) break; p += d.len; continue; }
    const lt = h & 0x0f;
    if (h & 0x40) {
      const le = u8[p + 1] === 0, g = dv.getUint16(p + 2, le), nf = u8[p + 4];
      p += 5;
      const fields: Array<{ n: number; s: number; o: number; b: number }> = [];
      let len = 0;
      for (let i = 0; i < nf; i++) { fields.push({ n: u8[p], s: u8[p + 1], o: len, b: u8[p + 2] }); len += u8[p + 1]; p += 3; }
      if (h & 0x20) { const nd = u8[p++]; for (let i = 0; i < nd; i++) { len += u8[p + 1]; p += 3; } }
      defs[lt] = { g, le, fields, len };
    } else {
      const d = defs[lt];
      if (!d) break;
      const nums = want[d.g];
      if (nums) {
        const f: FitMsg = {};
        for (const x of d.fields) if (nums.includes(x.n)) f[x.n] = rd(p + x.o, x.s, d.le, x.b);
        out[d.g].push(f);
      }
      p += d.len;
    }
  }
  return out;
}

const ok = (v: number | null | undefined, invalid: number) => (v == null || v === invalid ? null : v);

function lapsFrom(raw: FitMsg[]): Lap[] {
  return raw
    .map((f) => {
      const s = (ok(f[8], 0xffffffff) ?? ok(f[7], 0xffffffff) ?? 0) / 1000;
      const dist = (ok(f[9], 0xffffffff) ?? 0) / 100;
      return { hr: ok(f[15], 0xff), v: s ? round(dist / s, 3) : null, s: round(s, 0), m: dist ? round(dist, 0) : null };
    })
    .filter((l) => (l.s ?? 0) > 0);
}

/**
 * Douglas-Peucker: Indizes der Punkte, die nötig sind, damit keine weggelassene Stelle mehr als
 * `tol` Meter von der vereinfachten Linie abweicht. Kurven und Ecken bleiben so erhalten,
 * gerade Stücke werden ausgedünnt. Ohne Rekursion, damit auch lange Spuren sicher laufen.
 */
export function simplifyIdx(xy: Array<[number, number]>, tol: number): number[] {
  const n = xy.length;
  if (n < 3) return xy.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** GPS-Punkte (Nachricht 20, Felder 0/1 in Semicircles) → genaue, vereinfachte Route */
function routeFrom(raw: FitMsg[], tol = ROUTE_TOLERANCE_M, max = ROUTE_MAX_POINTS): Route {
  const deg = 180 / 2 ** 31;
  const pts: Route = [];
  for (const f of raw) {
    const la = ok(f[0], 0x7fffffff), lo = ok(f[1], 0x7fffffff);
    if (la == null || lo == null || (la === 0 && lo === 0)) continue;
    pts.push([la * deg, lo * deg]);
  }
  if (pts.length < 2) return [];
  // In Meter umrechnen (für kurze Strecken genau genug), dann vereinfachen;
  // wird die Obergrenze überschritten, Toleranz schrittweise erhöhen
  const lat0 = (pts[0][0] * Math.PI) / 180;
  const xy = pts.map(([la, lo]): [number, number] => [lo * 111320 * Math.cos(lat0), la * 110540]);
  let idx = simplifyIdx(xy, tol);
  for (let t = tol * 2; idx.length > max; t *= 2) idx = simplifyIdx(xy, t);
  return idx.map((i) => [round(pts[i][0], 5)!, round(pts[i][1], 5)!]);
}

/** Puls-Histogramm je ganzem bpm, aufsteigend: [bpm, Sekunden, Meter, Sekunden in Bewegung].
 *  Meter und „in Bewegung“ zählen nur ab 1,5 m/s, damit Stehen an der Ampel die Pace nicht verfälscht. */
export type HrHist = Array<[number, number, number, number]>;
const MOVING_MPS = 1.5;

/**
 * Sekundengenaue Pulsverteilung aus den Messpunkten (Nachricht 20: 253 Zeit, 3 Puls, 5 Strecke in cm).
 * Lücken über 10 s (Pause, Aufzeichnung angehalten) zählen nicht. So kann die Oberfläche Zeit und Pace
 * für beliebige eigene Zonen ausrechnen, ohne die Datei erneut zu laden.
 */
function hrHistFrom(raw: FitMsg[]): HrHist {
  const acc = new Map<number, [number, number, number]>();
  let t0: number | null = null, d0: number | null = null;
  for (const f of raw) {
    const t = ok(f[253], 0xffffffff), hr = ok(f[3], 0xff), dRaw = ok(f[5], 0xffffffff);
    const d = dRaw == null ? null : dRaw / 100;
    if (t != null && t0 != null && hr != null && hr > 30) {
      const dt = t - t0;
      if (dt > 0 && dt <= 10) {
        const dd = d != null && d0 != null && d >= d0 ? d - d0 : 0;
        const e = acc.get(hr) || [0, 0, 0];
        e[0] += dt;
        if (dd / dt >= MOVING_MPS) { e[1] += dd; e[2] += dt; }
        acc.set(hr, e);
      }
    }
    if (t != null) t0 = t;
    if (d != null) d0 = d;
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([bpm, [s, m, sm]]) => [bpm, s, Math.round(m), sm]);
}

// ---------- Verläufe über die Strecke (#17) ----------
/** Höchstens so viele Punkte je Verlauf; reicht für ein scharfes Diagramm auf dem iPhone */
export const STREAM_MAX_POINTS = 400;
/** Verläufe einer Einheit als gleich lange Reihen. d Meter, t Sekunden ab Start (ohne Pausen über 10 s),
 *  v m/s, hr bpm, alt m, cad Umdrehungen bzw. Schritte je Bein pro Minute (wie in der .fit), pw Watt.
 *  Reihen ohne einen einzigen Wert fehlen. */
export interface Streams { d?: Array<number | null>; t: number[]; v?: Array<number | null>; hr?: Array<number | null>; alt?: Array<number | null>; cad?: Array<number | null>; pw?: Array<number | null> }

/**
 * Messpunkte (Nachricht 20) → gemittelte Abschnitte. Mit Strecke wird nach Strecke eingeteilt (gleich lange
 * Stücke, Pausen fallen dabei heraus), sonst nach Zeit. Felder: 253 Zeit, 5 Strecke (cm), 6/73 Tempo (mm/s),
 * 3 Puls, 2/78 Höhe (÷5 − 500 m), 4 Kadenz, 7 Leistung.
 */
function streamsFrom(raw: FitMsg[], max = STREAM_MAX_POINTS): Streams | null {
  type P = { t: number; d: number | null; v: number | null; hr: number | null; alt: number | null; cad: number | null; pw: number | null };
  const pts: P[] = [];
  let t0: number | null = null, tPrev: number | null = null, moving = 0;
  for (const f of raw) {
    const t = ok(f[253], 0xffffffff);
    if (t == null) continue;
    if (t0 == null) t0 = t;
    // Laufende Zeit ohne Pausen: Lücken über 10 s zählen nicht
    if (tPrev != null && t - tPrev > 0 && t - tPrev <= 10) moving += t - tPrev;
    tPrev = t;
    const dRaw = ok(f[5], 0xffffffff), vRaw = ok(f[73], 0xffffffff) ?? ok(f[6], 0xffff);
    const aRaw = ok(f[78], 0xffffffff) ?? ok(f[2], 0xffff);
    const hr = ok(f[3], 0xff), cad = ok(f[4], 0xff), pw = ok(f[7], 0xffff);
    pts.push({
      t: moving, d: dRaw == null ? null : dRaw / 100, v: vRaw == null ? null : vRaw / 1000,
      hr: hr != null && hr > 30 ? hr : null, alt: aRaw == null ? null : aRaw / 5 - 500, cad, pw,
    });
  }
  if (pts.length < 2) return null;
  const withD = pts.filter((p) => p.d != null);
  const total = withD.length ? (withD[withD.length - 1].d as number) - (withD[0].d as number) : 0;
  const byDist = total > 200;
  const src = byDist ? withD : pts;
  const span = byDist ? total : pts[pts.length - 1].t;
  if (span <= 0) return null;
  const n = Math.min(max, src.length), start = byDist ? (src[0].d as number) : 0;
  const bins: P[][] = Array.from({ length: n }, () => []);
  for (const p of src) {
    const x = byDist ? (p.d as number) - start : p.t;
    bins[Math.min(n - 1, Math.floor((x / span) * n))].push(p);
  }
  const avg = (b: P[], k: keyof P, nd = 1) => { const v = b.map((p) => p[k]).filter((x): x is number => x != null); return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, nd) : null; };
  const out: Required<Streams> = { d: [], t: [], v: [], hr: [], alt: [], cad: [], pw: [] };
  for (const b of bins) {
    if (!b.length) continue;
    const last = b[b.length - 1];
    out.t.push(Math.round(last.t)); out.d.push(last.d == null ? null : round(last.d - (withD.length ? (withD[0].d as number) : 0), 0));
    out.v.push(avg(b, "v", 2)); out.hr.push(avg(b, "hr", 0)); out.alt.push(avg(b, "alt", 1)); out.cad.push(avg(b, "cad", 0)); out.pw.push(avg(b, "pw", 0));
  }
  const res: Streams = { t: out.t };
  for (const k of ["d", "v", "hr", "alt", "cad", "pw"] as const) if (out[k].some((x) => x != null && x !== 0)) res[k] = out[k];
  return res;
}

/** Runden, Route, Puls-Histogramm und Verläufe in einem Durchgang über die Datei */
export function fitParse(u8: Uint8Array): { laps: Lap[]; route: Route; hist: HrHist; streams: Streams | null } {
  const m = fitScan(u8, { 19: [7, 8, 9, 15], 20: [0, 1, 2, 3, 4, 5, 6, 7, 73, 78, 253] });
  return { laps: lapsFrom(m[19]), route: routeFrom(m[20]), hist: hrHistFrom(m[20]), streams: streamsFrom(m[20]) };
}

/** Je Zone [Sekunden, Meter, Sekunden in Bewegung]. `zones` sind die drei eigenen Bereiche Grundlage/Tempo/Schwelle;
 *  daraus entstehen fünf Zonen wie bei Strava: Z1 darunter, Z2–Z4 die Bereiche, Z5 darüber. */
export function zoneTotals(hist: HrHist, zones: number[][]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [bpm, s, m, sm] of hist) {
    const z = bpm < zones[0][0] ? 0 : bpm <= zones[0][1] ? 1 : bpm <= zones[1][1] ? 2 : bpm <= zones[2][1] ? 3 : 4;
    out[z][0] += s; out[z][1] += m; out[z][2] += sm || 0;
  }
  return out;
}

export function fitLaps(u8: Uint8Array): Lap[] {
  return fitParse(u8).laps;
}

// ---------- Fitnessalter (#78) ----------
/** Ein Baustein des Fitnessalters (intensive Tage, intensive Minuten, Ruhepuls, BMI/Körperfett) */
export interface FitAgeComp { key: string; value: number | null; target: number | null; potential: number | null; priority: number | null; stale: boolean }
export interface FitAge { day: string | null; chrono: number | null; fit: number | null; ach: number | null; prev: number | null; invalid: string | null; comps: FitAgeComp[] }

/**
 * Antwort von `fitnessage-service/fitnessage/v2/{calendarDate}` (Liste von FitnessAgeDTO, laut
 * Swagger-Doku, noch ungetestet). `components` ist ein Objekt: Name → Baustein. Nimmt den neuesten Eintrag.
 */
export function extractFitnessAge(json: unknown): FitAge | null {
  const list = Array.isArray(json) ? json.filter(isObj) : isObj(json) ? [json] : [];
  const usable = list.filter((x) => pick(x, "fitnessAge") != null || typeof x.invalidReason === "string");
  if (!usable.length) return null;
  const x = usable.reduce((a, b) => (String(b.lastUpdated ?? "") > String(a.lastUpdated ?? "") ? b : a));
  const comps: FitAgeComp[] = [];
  if (isObj(x.components)) {
    for (const [key, c] of Object.entries(x.components)) {
      if (!isObj(c)) continue;
      comps.push({
        key,
        value: round(c.value, 1),
        target: round(c.targetValue, 1),
        potential: round(c.potentialAge, 1),
        priority: pick(c, "priority"),
        stale: c.stale === true,
      });
    }
  }
  comps.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const day = typeof x.lastUpdated === "string" && /^\d{4}-\d{2}-\d{2}/.test(x.lastUpdated) ? x.lastUpdated.slice(0, 10) : null;
  return {
    day,
    chrono: pick(x, "chronologicalAge"),
    fit: round(x.fitnessAge, 1),
    ach: round(x.achievableFitnessAge, 1),
    prev: round(x.previousFitnessAge, 1),
    invalid: typeof x.invalidReason === "string" ? x.invalidReason : null,
    comps,
  };
}
