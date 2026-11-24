// Morgen-Push (#13): einmal am Tag die Erholungs-Ampel aufs iPhone, zur eingestellten Uhrzeit oder automatisch,
// sobald der Schlaf der letzten Nacht da ist (Garmin: Abfrage alle 10 Min. am Morgen, WHOOP: Webhook).
// Läuft im Cron (alle 30 Minuten) nach dem Garmin-Sync. Sind Schlaf/HRV der letzten Nacht noch nicht
// bei Garmin (Uhr noch nicht synchronisiert), wird bis zu 3 Stunden lang später erneut versucht,
// statt eine leere Meldung zu schicken. Danach kommt die Meldung mit dem letzten Stand und einem Hinweis.
import type { Env } from "./env";
import { kvGetJson, kvPut, localDate } from "./util";
import { buildData } from "./data";
import { decide, decideAuto, pushText, type Ampel } from "./ampel";
import { DEFAULT_CFG, sendAll, type PushCfg } from "./push";
import { kindOn, newsStep, newsText } from "./mitteilungen";
import { NEWS } from "./neuigkeiten";
import type { Profile } from "./garmin/sync";
import { loadPlan } from "./training-api";
import { sessionLine } from "./training";

export const localTime = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export async function morningPush(env: Env, force = false): Promise<{ result: string }> {
  const cfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
  const today = localDate(tz), now = localTime(tz);
  const data = await buildData(env, 60);
  const ampel = data.ampel as Ampel | null;
  const daily = data.daily as Record<string, any>;
  let step: "send" | "send-stale" | "wait" | "skip";
  if (force) step = ampel?.day === today ? "send" : "send-stale";
  else if (cfg.mode === "auto") {
    // Letzte Nacht in der bevorzugten Quelle (data.ts wählt Garmin, WHOOP … je Metrik); Schlaf zählt zum Tag des Aufwachens
    const t = daily[today] || {};
    const sleep = t.slp != null, hrv = t.hrv != null;
    // HRV erwarten nur, wenn es sie sonst meistens gibt (mind. 3 der letzten 7 Nächte)
    let hrvNights = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.parse(today + "T12:00:00Z") - i * 864e5).toISOString().slice(0, 10);
      if (daily[d]?.hrv != null) hrvNights++;
    }
    if (sleep && cfg.sleepSeenDay !== today) { cfg.sleepSeenDay = today; cfg.sleepSeenAt = new Date().toISOString(); }
    const sleepSeenMin = sleep && cfg.sleepSeenAt ? (Date.now() - Date.parse(cfg.sleepSeenAt)) / 60000 : null;
    step = decideAuto({ on: kindOn(cfg, "morgen"), latest: cfg.latest || "11:00", lastSent: cfg.lastSent }, today, now, { sleep, hrv, hrvUsual: hrvNights >= 3, sleepSeenMin });
  } else step = decide({ ...cfg, on: kindOn(cfg, "morgen") }, today, now, ampel?.day ?? null);
  if (step === "skip") return { result: "nichts zu tun" };
  if (step === "wait") {
    cfg.lastTry = new Date().toISOString();
    cfg.lastResult = cfg.mode === "auto" && cfg.sleepSeenDay === today ? "Schlaf ist da, warte noch kurz auf die HRV" : "Warte auf die Schlafdaten der letzten Nacht";
    await kvPut(env, "pushCfg", JSON.stringify(cfg));
    return { result: cfg.lastResult };
  }
  let msg: { title: string; body: string };
  if (!ampel) msg = { title: "⚪️ Noch keine Daten", body: "Für die Erholungs-Ampel fehlen noch HRV oder Schlaf." };
  else {
    msg = pushText(ampel, daily[ampel.day]);
    if (step === "send-stale") msg.body = "Die letzte Nacht ist noch nicht da – Stand vom " + ampel.day.slice(8, 10) + "." + ampel.day.slice(5, 7) + ". " + msg.body;
  }
  // Trainingsplan (#20): Einheit des Tages anhängen
  const plan = await loadPlan(env).catch(() => null);
  const todays = (plan?.sessions || []).filter((x) => x.date === today);
  if (todays.length) msg.body += " · Heute: " + todays.map(sessionLine).join(" + ");
  const res = await sendAll(env, { ...msg, url: "/", tag: "morgen" }, cfg.origin || "mailto:health-hub@localhost");
  cfg.lastTry = new Date().toISOString();
  cfg.lastResult = res.ok ? `Gesendet an ${res.ok} ${res.ok === 1 ? "Gerät" : "Geräte"}` : res.failed.length ? "Fehlgeschlagen: " + res.failed.join(", ") : "Kein Gerät angemeldet";
  if (!force) cfg.lastSent = today;
  await kvPut(env, "pushCfg", JSON.stringify(cfg));
  return { result: cfg.lastResult };
}

/**
 * Neue Funktionen (#161): Gibt es seit der letzten Meldung einen neuen Eintrag in „Was ist neu?“, eine kurze Mitteilung
 * schicken (nur auf Wunsch, nur tagsüber). Läuft im Cron nach dem Morgen-Push. Beim ersten Mal nur den Stand merken.
 */
export async function newsPush(env: Env): Promise<{ result: string }> {
  const cfg = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)) };
  const profile = await kvGetJson<Profile | null>(env, "profile", null);
  const tz = profile?.tz || env.TIMEZONE || "Europe/Berlin";
  const step = newsStep(cfg, NEWS.map((n) => n.id), localTime(tz));
  if (step === "nichts") return { result: "nichts zu tun" };
  if (step === "senden") {
    const res = await sendAll(env, { ...newsText(NEWS, cfg.newsSent), url: "/", tag: "neu" }, cfg.origin || "mailto:health-hub@localhost");
    // Kein Gerät erreicht: beim nächsten Lauf noch einmal versuchen
    if (!res.ok) return { result: res.failed.length ? "Fehlgeschlagen: " + res.failed.join(", ") : "Kein Gerät angemeldet" };
  }
  // Neu laden, damit gleichzeitige Änderungen (z. B. Morgen-Push) nicht überschrieben werden
  const fresh = { ...DEFAULT_CFG, ...(await kvGetJson<PushCfg>(env, "pushCfg", DEFAULT_CFG)), newsSent: NEWS[0].id };
  await kvPut(env, "pushCfg", JSON.stringify(fresh));
  return { result: step === "senden" ? "Neuigkeit gesendet" : "Stand gemerkt" };
}
