// Anmeldung: App-Passwort -> HMAC-signiertes Cookie (30 Tage). Zusätzlich optional ein
// Bearer-Token (API_TOKEN) für Skripte und später den MCP-Zugang.
import LOGIN from "./login.html";
import type { Env } from "./env";
import { hasPasskeys } from "./passkey";
import { b64u, enc, fromB64u, hmacKey, kvDelete, kvGet, kvPut, respond, SECURITY_HEADERS } from "./util";
import { checkPassword as matchesPassword } from "./setup";

const SESSION_DAYS = 30;
const MAX_FAILS = 10;

/** Login-Seite. Gibt es Passkeys (#95), ist „Mit Passkey anmelden“ der Hauptweg, das Passwort die Reserve. */
export async function loginPage(env: Env, msg = "", status = 200): Promise<Response> {
  const pk = await hasPasskeys(env);
  let html = LOGIN.replace("<!--MSG-->", msg);
  if (pk) html = html.replace("<body>", '<body class="pk">').replace(" autofocus", "");
  return respond(html, status, "text/html; charset=utf-8");
}

/** Fehlversuche (Passwort und Passkey zusammen): nach MAX_FAILS 15 Minuten Sperre. */
export async function tooManyFails(env: Env): Promise<boolean> {
  return (Number(await kvGet(env, "loginFails")) || 0) >= MAX_FAILS;
}
export async function noteFail(env: Env) {
  const fails = Number(await kvGet(env, "loginFails")) || 0;
  await kvPut(env, "loginFails", String(fails + 1), 900);
  await new Promise((r) => setTimeout(r, 800));
}

/** Neue Sitzung: Cookie mit Ablaufzeit und HMAC-Signatur. */
export async function sessionCookie(env: Env): Promise<string> {
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode("session:" + exp)));
  return `session=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function sessionValid(req: Request, env: Env): Promise<boolean> {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("Cookie") || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64u(sig), enc.encode("session:" + exp));
  } catch {
    return false;
  }
}

/** Bearer-Token prüfen (zeitkonstant über HMAC-Vergleich). */
export async function bearerValid(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!env.API_TOKEN || !auth.startsWith("Bearer ")) return false;
  const key = await hmacKey(env);
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode("tok:" + env.API_TOKEN));
  return crypto.subtle.verify("HMAC", key, expected, enc.encode("tok:" + auth.slice(7)));
}

/** App-Passwort prüfen, mit gemeinsamer Sperre nach MAX_FAILS Fehlversuchen (Login, Passkey #95 und Claude-Zustimmung #5) */
export async function checkPassword(env: Env, given: string): Promise<"ok" | "falsch" | "gesperrt"> {
  if (await tooManyFails(env)) return "gesperrt";
  const key = await hmacKey(env);
  if (!(await matchesPassword(env, given, key))) {
    await noteFail(env);
    return "falsch";
  }
  await kvDelete(env, "loginFails");
  return "ok";
}

export async function login(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const r = await checkPassword(env, String(form.get("password") || ""));
  if (r === "gesperrt") return loginPage(env, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.", 429);
  if (r === "falsch") return loginPage(env, "Passwort falsch.", 401);
  return startSession(env);
}

/** Angemeldet weiterleiten (nach dem Login, Passkey oder der Ersteinrichtung) */
export async function startSession(env: Env): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: { Location: "/", "Set-Cookie": await sessionCookie(env), ...SECURITY_HEADERS },
  });
}

export function logout(): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", ...SECURITY_HEADERS },
  });
}
