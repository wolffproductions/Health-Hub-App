// Withings-Antworten -> Tageswerte. Reine Funktionen, getestet in test/withings.test.ts.
//
// Metriken (Feldnamen der Oberfläche, source = 'withings'):
//   kg Gewicht · fat Körperfett % · fatKg Fettmasse kg · leanKg fettfreie Masse kg · muscle Muskelmasse kg
//   water Wasser kg · bone Knochenmasse kg · visceral Viszeralfett (Index)
// Pro Tag zählt die letzte Messung (Ortszeit laut Withings-Zeitzone).
import type { MetricRow } from "../garmin/extract";

/** Withings-Messtypen (meastype) → Metrik */
export const MEASTYPES: Record<number, string> = {
  1: "kg",
  5: "leanKg",
  6: "fat",
  8: "fatKg",
  76: "muscle",
  77: "water",
  88: "bone",
  170: "visceral",
};

/** Kalendertag in einer Zeitzone (YYYY-MM-DD) */
function dayIn(tsSeconds: number, tz: string): string {
  try {
    return new Date(tsSeconds * 1000).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
  }
}

/**
 * Antwort von `measure?action=getmeas` → Tageswerte. Wert = value · 10^unit.
 * Nur echte Messungen (category 1), keine Ziele (category 2).
 */
export function extractMeasures(body: unknown, fallbackTz = "Europe/Berlin"): MetricRow[] {
  const b = body as any;
  const groups: any[] = Array.isArray(b?.measuregrps) ? b.measuregrps : [];
  const tz = typeof b?.timezone === "string" && b.timezone ? b.timezone : fallbackTz;
  // je Tag und Metrik die neueste Messung
  const best = new Map<string, { t: number; v: number }>();
  for (const g of groups) {
    if (!g || (g.category != null && g.category !== 1) || typeof g.date !== "number" || !Array.isArray(g.measures)) continue;
    const day = dayIn(g.date, tz);
    for (const m of g.measures) {
      const metric = MEASTYPES[m?.type];
      if (!metric || typeof m.value !== "number" || typeof m.unit !== "number") continue;
      const v = Math.round(m.value * 10 ** m.unit * 100) / 100;
      if (!isFinite(v) || v <= 0) continue;
      const key = day + "|" + metric;
      const prev = best.get(key);
      if (!prev || g.date >= prev.t) best.set(key, { t: g.date, v });
    }
  }
  return [...best].map(([k, { v }]) => {
    const [day, metric] = k.split("|");
    return { day, metric, value: v };
  });
}

/** HMAC-SHA256 (hex) über die Werte, nach Parameternamen sortiert und mit Komma verbunden */
export async function sign(secret: string, params: Record<string, string>): Promise<string> {
  const msg = Object.keys(params).sort().map((k) => params[k]).join(",");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
