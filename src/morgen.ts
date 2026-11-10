// Morgen-Push (#13): einmal am Tag zur eingestellten Uhrzeit die Erholungs-Ampel aufs iPhone.
// Läuft im Cron (alle 30 Minuten) nach dem Garmin-Sync. Sind Schlaf/HRV der letzten Nacht noch nicht
// bei Garmin (Uhr noch nicht synchronisiert), wird bis zu 3 Stunden lang später erneut versucht,
// statt eine leere Meldung zu schicken. Danach kommt die Meldung mit dem letzten Stand und einem Hinweis.
import type { Env } from "./env";
import { kvGetJson, kvPut, localDate } from "./util";
import { buildData } from "./data";
import { decide, pushText, type Ampel } from "./ampel";
import { DEFAULT_CFG, sendAll, type PushCfg } from "./push";
import type { Profile } from "./garmin/sync";

export const localTime = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export async function morningPush(env: Env, force = false): Promise<{ result: string }> {
  const cfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
  const today = localDate(tz), now = localTime(tz);
  const data = await buildData(env, 60);
  const ampel = data.ampel as Ampel | null;
  const step = force ? (ampel?.day === today ? "send" : "send-stale") : decide(cfg, today, now, ampel?.day ?? null);
  if (step === "skip") return { result: "nichts zu tun" };
  if (step === "wait") {
    cfg.lastTry = new Date().toISOString(); cfg.lastResult = "Warte auf die Schlafdaten der letzten Nacht";
    await kvPut(env, "pushCfg", JSON.stringify(cfg));
    return { result: cfg.lastResult };
  }
  let msg: { title: string; body: string };
  if (!ampel) msg = { title: "⚪️ Noch keine Daten", body: "Für die Erholungs-Ampel fehlen noch HRV oder Schlaf." };
  else {
    msg = pushText(ampel, (data.daily as Record<string, any>)[ampel.day]);
    if (step === "send-stale") msg.body = "Die letzte Nacht ist noch nicht bei Garmin – Stand vom " + ampel.day.slice(8, 10) + "." + ampel.day.slice(5, 7) + ". " + msg.body;
  }
  const res = await sendAll(env, { ...msg, url: "/", tag: "morgen" }, cfg.origin || "mailto:health-hub@localhost");
  cfg.lastTry = new Date().toISOString();
  cfg.lastResult = res.ok ? `Gesendet an ${res.ok} ${res.ok === 1 ? "Gerät" : "Geräte"}` : res.failed.length ? "Fehlgeschlagen: " + res.failed.join(", ") : "Kein Gerät angemeldet";
  if (!force) cfg.lastSent = today;
  await kvPut(env, "pushCfg", JSON.stringify(cfg));
  return { result: cfg.lastResult };
}
