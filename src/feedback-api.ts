// Feedback (#162): Die App schickt seit #186 DIREKT an den Feedback-Worker (CORS), weil eine Instanz im selben
// Cloudflare-Konto ihn nicht aufrufen darf. Diese Route bleibt als Ausweich für Skripte. Früher: Instanz →
// (Repo hhub-team/feedback, läuft in Eddies Cloudflare-Konto) weitergibt. Der legt ein Issue an; Pablo und Eddie
// bekommen über GitHub eine Benachrichtigung. Es geht nur raus, was die Person im Formular sieht und absendet.
import type { Env } from "./env";
import { json } from "./util";

/** Adresse des Feedback-Workers; mit der Variable FEEDBACK_URL änderbar (z. B. eigener Worker) */
export const FEEDBACK_URL = "https://hhub-feedback.eddie-training.workers.dev/send";

export async function feedbackRoute(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  const text = await req.text();
  if (text.length > 3_400_000) return json({ ok: false, error: "Zu groß (Bild höchstens 2 MB)." }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return json({ ok: false, error: "Ungültige Anfrage." }, 400); }
  // Nur bekannte Felder weitergeben
  const out: Record<string, unknown> = {};
  for (const k of ["kind", "text", "name", "version", "device", "view", "image", "website"]) if (body[k] != null) out[k] = body[k];
  const target = (env as unknown as { FEEDBACK_URL?: string }).FEEDBACK_URL || FEEDBACK_URL;
  try {
    const r = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out), signal: AbortSignal.timeout(20000), redirect: "manual" });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; nr?: number } | null;
    if (!j) return json({ ok: false, error: "Feedback-Stelle nicht erreichbar (" + r.status + ")." }, 502);
    return json(j, r.ok ? 200 : r.status);
  } catch {
    return json({ ok: false, error: "Feedback-Stelle nicht erreichbar. Bitte später nochmal." }, 502);
  }
}
