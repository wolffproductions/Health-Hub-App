// Mitteilungen (#161): welche Push-Meldungen jemand bekommt, je Art einzeln an/aus, und wann eine Meldung zu neuen
// Funktionen („Was ist neu?“, #91) fällig ist. Reine Funktionen ohne Importe, getestet in test/mitteilungen.test.ts.
// Das Abo selbst (Gerät angemeldet, `on`) bleibt wie beim Morgen-Push (#13) in `pushCfg`; dort stehen auch `kinds` und `newsSent`.

/** Arten von Mitteilungen. „wetter“: gute Fenster zum Radfahren (Rad-Wetter-Planer, #153, src/radwetter-api.ts) */
export type PushKind = "morgen" | "freunde" | "neu" | "wetter";
export const PUSH_KINDS: PushKind[] = ["morgen", "freunde", "neu", "wetter"];
/**
 * Standard je Art, solange man nichts gewählt hat. Morgenbericht und Freunde waren schon vor #161 an, sobald Push
 * eingeschaltet war; das bleibt so. Neue Funktionen und Rad-Wetter nur auf Wunsch.
 */
export const PUSH_KIND_DEFAULT: Record<PushKind, boolean> = { morgen: true, freunde: true, neu: false, wetter: false };

export interface KindCfg { on: boolean; kinds?: Partial<Record<PushKind, boolean>>; newsSent?: string }

/** Ist eine Art eingeschaltet? Nur, wenn Push überhaupt an ist (ein Gerät angemeldet). */
export function kindOn(cfg: KindCfg, kind: PushKind): boolean {
  if (!cfg.on) return false;
  const v = cfg.kinds?.[kind];
  return typeof v === "boolean" ? v : PUSH_KIND_DEFAULT[kind];
}
/** Alle Arten mit ihrem Stand (für die Oberfläche), unabhängig davon, ob Push gerade an ist */
export function kindsOf(cfg: KindCfg): Record<PushKind, boolean> {
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, kindOn({ ...cfg, on: true }, k)])) as Record<PushKind, boolean>;
}

/** Neue Funktionen nur tagsüber melden (Ortszeit), nicht nachts, wenn gerade ein Update eingespielt wird */
export const NEWS_FROM = "08:00", NEWS_UNTIL = "21:00";

/**
 * Ist eine Meldung zu neuen Funktionen fällig? ids = „Was ist neu?“-Einträge, neueste zuerst.
 * - "merken": noch nie gemeldet (gerade eingeschaltet oder erstes Mal): den aktuellen Stand nur merken, nichts schicken,
 *   damit nicht sofort eine alte Neuigkeit kommt
 * - "senden": seit dem letzten Mal gibt es neue Einträge, und es ist Tag
 * - "nichts": aus, schon gemeldet oder gerade Nacht (dann beim nächsten Lauf am Morgen)
 */
export function newsStep(cfg: KindCfg, ids: string[], now: string): "senden" | "merken" | "nichts" {
  if (!kindOn(cfg, "neu") || !ids.length) return "nichts";
  if (!cfg.newsSent) return "merken";
  if (cfg.newsSent === ids[0]) return "nichts";
  if (now < NEWS_FROM || now > NEWS_UNTIL) return "nichts";
  return "senden";
}

/** Text der Meldung: Titel des neuesten Eintrags, dazu wie viele es seit der letzten Meldung insgesamt sind */
export function newsText(entries: Array<{ id: string; titel: string }>, lastSent?: string): { title: string; body: string } {
  const idx = lastSent ? entries.findIndex((e) => e.id === lastSent) : -1;
  const fresh = idx === -1 ? entries.slice(0, 1) : entries.slice(0, idx);
  const more = fresh.length - 1;
  return {
    title: "Neu in deiner App",
    body: fresh[0].titel + (more > 0 ? ` (und ${more} ${more === 1 ? "weitere Neuerung" : "weitere Neuerungen"})` : "") + ". Tippe für Details.",
  };
}
