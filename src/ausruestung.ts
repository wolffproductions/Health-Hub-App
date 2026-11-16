// Ausrüstung (#52): Schuhe und Räder mit Kilometerstand. Reine Funktionen, getestet in test/ausruestung.test.ts.
// Bewusst ohne Importe, damit die Tests die Datei direkt laden können.
//
// Kilometerstand:
//   - aus Strava übernommen: Stravas eigener Stand (zählt alle Strava-Einheiten mit diesem Teil) plus Einheiten,
//     die du in der App selbst zugeordnet hast und die Strava nicht kennt
//   - selbst angelegt: Start-Kilometerstand plus alle zugeordneten Einheiten
// Zuordnung je Einheit: deine eigene Wahl in der App geht vor, sonst das Teil aus Strava.

export type GearSport = "run" | "ride";
export interface GearItem {
  id: string;
  name: string;
  sport: GearSport;
  /** Kilometer vor der ersten Einheit in der App (nur selbst angelegt) */
  startKm: number;
  /** Grenze, ab der ein Hinweis kommt (z. B. 700 km bei Laufschuhen), null = keine */
  limitKm: number | null;
  retired: boolean;
  /** Strava-Kennung („g123…“ bei Schuhen, „b123…“ bei Rädern) */
  strava?: string;
  /** Kilometerstand laut Strava */
  stravaKm?: number;
}
export interface GearStore {
  items: GearItem[];
  /** Einheit → Teil (eigene Wahl), "" = bewusst ohne */
  assign: Record<string, string>;
  /** letzter Abgleich mit Strava (ISO) */
  stravaAt?: string;
}
export interface GearAct { id: string; date: string; km?: number | null; hidden?: unknown; src?: string; gear?: string | null; strava?: { gear?: string | null } | null }
export interface GearUse { km: number; count: number; last: string | null; first: string | null }

export const SHOE_LIMIT = 700;
export const emptyStore = (): GearStore => ({ items: [], assign: {} });

/** Strava-Teil einer Einheit (bei zusammengeführten an `strava`, bei reinen Strava-Einheiten direkt) */
export const stravaGearOf = (a: GearAct): string | null => (a.strava ? a.strava.gear ?? null : a.src === "strava" ? a.gear ?? null : null);

/** Welches Teil gehört zur Einheit? Eigene Wahl vor Strava. Liefert die Teil-ID oder null. */
export function gearOf(a: GearAct, store: GearStore): string | null {
  if (Object.prototype.hasOwnProperty.call(store.assign, a.id)) return store.assign[a.id] || null;
  const sg = stravaGearOf(a);
  return sg ? store.items.find((i) => i.strava === sg)?.id ?? null : null;
}

/** Kilometerstand, Anzahl und erste/letzte Nutzung je Teil */
export function gearUsage(store: GearStore, acts: GearAct[]): Record<string, GearUse> {
  const out: Record<string, GearUse> = {};
  for (const it of store.items) out[it.id] = { km: it.strava && it.stravaKm != null ? it.stravaKm : it.startKm || 0, count: 0, last: null, first: null };
  for (const a of acts) {
    if (a.hidden) continue;
    const id = gearOf(a, store);
    const u = id ? out[id] : null;
    if (!u) continue;
    const it = store.items.find((i) => i.id === id)!;
    u.count++;
    if (!u.last || a.date > u.last) u.last = a.date;
    if (!u.first || a.date < u.first) u.first = a.date;
    // Bei Strava-Teilen steckt die Einheit schon in Stravas Stand, wenn Strava sie mit diesem Teil kennt
    const inStrava = !!it.strava && it.stravaKm != null && stravaGearOf(a) === it.strava;
    if (!inStrava) u.km += a.km || 0;
  }
  for (const u of Object.values(out)) u.km = Math.round(u.km * 10) / 10;
  return out;
}

/**
 * Liste aus Strava (`GET /athlete`: shoes[], bikes[] mit id, name, distance in Metern, retired) übernehmen.
 * Neue Teile kommen dazu, bekannte bekommen Namen und Stand aktualisiert. Eigene Angaben (Grenze, Ruhestand) bleiben.
 */
export function mergeStravaGear(store: GearStore, athlete: any): GearStore {
  const items = store.items.map((i) => ({ ...i }));
  const take = (list: unknown, sport: GearSport) => {
    if (!Array.isArray(list)) return;
    for (const g of list) {
      if (!g || typeof g.id !== "string") continue;
      const km = Math.round((Number(g.distance) || 0) / 100) / 10;
      const name = String(g.name || g.nickname || "").slice(0, 60) || (sport === "run" ? "Laufschuh" : "Rad");
      const known = items.find((i) => i.strava === g.id);
      if (known) { known.name = name; known.stravaKm = km; continue; }
      items.push({ id: "s-" + g.id, name, sport, startKm: 0, limitKm: sport === "run" ? SHOE_LIMIT : null, retired: !!g.retired, strava: g.id, stravaKm: km });
    }
  };
  take(athlete?.shoes, "run");
  take(athlete?.bikes, "ride");
  return { ...store, items, stravaAt: new Date().toISOString() };
}

/** Eingabe aus der Oberfläche prüfen. Liefert das bereinigte Teil oder eine Fehlermeldung. */
export function cleanItem(x: any, existing?: GearItem): GearItem | string {
  const name = String(x?.name ?? existing?.name ?? "").trim().slice(0, 60);
  if (!name) return "Bitte einen Namen eintragen.";
  const sport: GearSport = x?.sport === "ride" ? "ride" : x?.sport === "run" ? "run" : existing?.sport ?? "run";
  const startKm = x?.startKm === "" || x?.startKm == null ? existing?.startKm ?? 0 : Number(x.startKm);
  if (!isFinite(startKm) || startKm < 0 || startKm > 100000) return "Kilometerstand zwischen 0 und 100.000 km.";
  const lim = x?.limitKm === "" || x?.limitKm === null ? null : x?.limitKm == null ? existing?.limitKm ?? null : Number(x.limitKm);
  if (lim != null && (!isFinite(lim) || lim < 50 || lim > 100000)) return "Grenze zwischen 50 und 100.000 km oder leer lassen.";
  return {
    id: existing?.id ?? "", name, sport, startKm: Math.round(startKm * 10) / 10, limitKm: lim == null ? null : Math.round(lim),
    retired: x?.retired == null ? existing?.retired ?? false : !!x.retired,
    ...(existing?.strava ? { strava: existing.strava, stravaKm: existing.stravaKm } : {}),
  };
}
