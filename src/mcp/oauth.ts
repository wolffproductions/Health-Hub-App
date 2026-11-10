// Anmeldung für Claude (#5): OAuth 2.1 mit PKCE und dynamischer Registrierung, wie es Claude-Connectoren
// erwarten (MCP-Spezifikation „Authorization“). Die eigene App ist zugleich Anmelde- und Datenserver.
// Zustimmung mit dem App-Passwort (bzw. bestehender Sitzung). Alles in kv:
//   oauth:client:<id>  registrierte App (Name, Rückleitungsadressen, zuletzt benutzt)
//   oauth:code:<code>  Einmal-Code, 5 Minuten
//   oauth:at:<hash>    Zugangs-Token (nur der SHA-256-Hash wird gespeichert), 1 Stunde
//   oauth:rt:<hash>    Erneuerungs-Token, 30 Tage, wird bei jeder Erneuerung ersetzt
import type { Env } from "../env";
import { checkPassword, sessionValid } from "../auth";
import { b64u, enc, kvDelete, kvGet, kvGetJson, kvPut, SECURITY_HEADERS } from "../util";
import { pkceOk, redirectAllowed } from "./server";

export const SCOPE = "health:read";
const AT_TTL = 3600, RT_TTL = 30 * 86400, CODE_TTL = 300, MAX_CLIENTS = 10;

export interface OAuthClient { id: string; name: string; redirect_uris: string[]; created: string; lastUsed?: string }
interface Code { client: string; redirect: string; challenge: string; scope: string }
interface Tok { client: string }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const jsonC = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...CORS, ...extra } });
const oerr = (error: string, desc: string, status = 400) => jsonC({ error, error_description: desc }, status);
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const hash = async (s: string) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const nowS = () => Math.floor(Date.now() / 1000);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const corsPreflight = () => new Response(null, { status: 204, headers: CORS });

/** Beschreibung des Datenservers (RFC 9728) */
export const protectedResource = (origin: string) =>
  jsonC({ resource: origin + "/mcp", authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Health Hub" });

/** Beschreibung des Anmeldeservers (RFC 8414) */
export const authServerMeta = (origin: string) =>
  jsonC({
    issuer: origin,
    authorization_endpoint: origin + "/oauth/authorize",
    token_endpoint: origin + "/oauth/token",
    registration_endpoint: origin + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });

/** 401 für /mcp mit Hinweis, wo die Anmeldung beschrieben ist */
export const unauthorized = (origin: string) =>
  new Response(JSON.stringify({ error: "Nicht angemeldet" }), {
    status: 401,
    headers: { "Content-Type": "application/json", ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` },
  });

export async function listClients(env: Env): Promise<OAuthClient[]> {
  const { results } = await env.DB.prepare("SELECT value FROM kv WHERE key LIKE 'oauth:client:%'").all<{ value: string }>();
  return results.map((r) => JSON.parse(r.value) as OAuthClient).sort((a, b) => (a.created < b.created ? -1 : 1));
}

/** App entfernen: Registrierung und alle ihre Tokens */
export async function removeClient(env: Env, id: string) {
  await kvDelete(env, "oauth:client:" + id);
  await env.DB.prepare("DELETE FROM kv WHERE (key LIKE 'oauth:at:%' OR key LIKE 'oauth:rt:%') AND json_extract(value, '$.client') = ?").bind(id).run();
}

/** Dynamische Registrierung (RFC 7591), öffentlich; höchstens MAX_CLIENTS Apps */
export async function register(req: Request, env: Env) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const uris = Array.isArray(body?.redirect_uris) ? body!.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every(redirectAllowed)) return oerr("invalid_redirect_uri", "Rückleitungsadressen müssen https oder lokal sein.");
  // Registrierung ist öffentlich: Apps, die nach einem Tag nie zugegriffen haben, räumen den Platz wieder frei
  for (const c of await listClients(env)) if (!c.lastUsed && Date.now() - Date.parse(c.created) > 864e5) await removeClient(env, c.id);
  if ((await listClients(env)).length >= MAX_CLIENTS) return oerr("invalid_client_metadata", "Zu viele verbundene Apps. Entferne eine unter Konto → Claude.");
  const name = String(body?.client_name || "Unbekannte App").replace(/[\u0000-\u001f]/g, "").slice(0, 60);
  const c: OAuthClient = { id: rand(16), name, redirect_uris: uris as string[], created: new Date().toISOString() };
  await kvPut(env, "oauth:client:" + c.id, JSON.stringify(c));
  return jsonC({ client_id: c.id, client_name: c.name, redirect_uris: c.redirect_uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201);
}

// ---------- Zustimmung ----------
const PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function consentPage(p: Record<string, string>, client: OAuthClient, loggedIn: boolean, msg = "", status = 200) {
  const host = new URL(p.redirect_uri).host;
  const hidden = PARAMS.filter((k) => p[k]).map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join("");
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Zugriff erlauben</title>
<style>
:root{--bg:#f2f2f7;--panel:#fff;--fg:#000;--muted:rgba(60,60,67,.6);--line:rgba(60,60,67,.18);--tint:#ff2d55;--fill:rgba(120,120,128,.12);--bad:#ff3b30;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#000;--panel:#1c1c1e;--fg:#fff;--muted:rgba(235,235,245,.6);--line:rgba(84,84,88,.6);--tint:#ff375f;--fill:rgba(118,118,128,.24);--bad:#ff453a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif}
main{max-width:440px;margin:0 auto;padding:48px 20px;display:flex;flex-direction:column;gap:16px}
h1{font-size:28px;margin:0}.card{background:var(--panel);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px}.card p{margin:0}
.note{font-size:15px;color:var(--muted);margin:0}ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:15px}
input[type=password]{width:100%;font:inherit;padding:11px 12px;border:0;border-radius:10px;background:var(--fill);color:var(--fg);min-height:44px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}button{font:inherit;font-weight:600;padding:12px 18px;border-radius:12px;border:0;cursor:pointer}
.ok{background:var(--tint);color:#fff}.no{background:var(--fill);color:var(--tint)}.msg{color:var(--bad);font-size:15px;margin:0}
</style></head><body><main>
<h1>Zugriff erlauben?</h1>
<div class="card">
<p><b>${esc(client.name)}</b> möchte deine Health-Hub-Daten lesen.</p>
<p class="note">Rückleitung an ${esc(host)}</p>
<ul><li>Tageswerte (Ruhepuls, HRV, Schlaf, Stress, Body Battery …)</li><li>Einheiten mit Runden, Wochenübersicht, VO2max</li><li>Stimmung nur, wenn du sie unter Konto → Claude freigegeben hast</li><li>Nur lesen, nichts ändern</li></ul>
<p class="note">Was Claude abruft, wird Teil des Gesprächs und damit an Anthropic übertragen. Den Zugriff entziehst du jederzeit unter Konto → Claude.</p>
</div>
<form class="card" method="post" action="/oauth/authorize">${hidden}
${loggedIn ? '<p class="note">Du bist in der App angemeldet.</p>' : '<label class="note" for="pw">App-Passwort</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>'}
${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
<div class="row"><button class="ok" name="decision" value="allow">Erlauben</button><button class="no" name="decision" value="deny" formnovalidate>Ablehnen</button></div>
</form></main></body></html>`;
  // Nach dem Absenden leitet der Server zur App zurück: diese Adresse muss das Formular dürfen
  const csp = SECURITY_HEADERS["Content-Security-Policy"].replace("form-action 'self'", `form-action 'self' ${new URL(p.redirect_uri).origin}`);
  // „same-origin“ statt „no-referrer“: sonst schickt der Browser beim Absenden Origin: null und die Herkunftsprüfung schlägt fehl
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, "Content-Security-Policy": csp, "Referrer-Policy": "same-origin" } });
}

/** Parameter prüfen; Fehler vor der Rückleitung als Text, sonst die App */
async function checkAuthParams(p: Record<string, string>, env: Env): Promise<OAuthClient | string> {
  const client = p.client_id ? await kvGetJson<OAuthClient | null>(env, "oauth:client:" + p.client_id, null) : null;
  if (!client) return "Unbekannte App. Bitte die Verbindung in Claude neu einrichten.";
  if (!client.redirect_uris.includes(p.redirect_uri)) return "Rückleitungsadresse passt nicht zur App.";
  if (p.response_type !== "code") return "Nur response_type=code wird unterstützt.";
  if (!p.code_challenge || p.code_challenge_method !== "S256") return "PKCE (S256) ist erforderlich.";
  return client;
}
const plain = (msg: string, status = 400) => new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
const back = (p: Record<string, string>, q: Record<string, string>) => {
  const u = new URL(p.redirect_uri);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  if (p.state) u.searchParams.set("state", p.state);
  return new Response(null, { status: 302, headers: { Location: u.toString(), ...SECURITY_HEADERS } });
};

export async function authorize(req: Request, url: URL, env: Env) {
  const loggedIn = await sessionValid(req, env);
  if (req.method === "GET") {
    const p = Object.fromEntries(PARAMS.map((k) => [k, url.searchParams.get(k) || ""]));
    const c = await checkAuthParams(p, env);
    return typeof c === "string" ? plain(c) : consentPage(p, c, loggedIn);
  }
  if (req.method !== "POST") return plain("Nicht erlaubt", 405);
  if (req.headers.get("Origin") !== url.origin) return plain("Ungültige Herkunft", 403);
  const form = await req.formData();
  const p = Object.fromEntries(PARAMS.map((k) => [k, String(form.get(k) || "")]));
  const c = await checkAuthParams(p, env);
  if (typeof c === "string") return plain(c);
  if (form.get("decision") !== "allow") return back(p, { error: "access_denied" });
  if (!loggedIn) {
    const r = await checkPassword(env, String(form.get("password") || ""));
    if (r === "gesperrt") return consentPage(p, c, false, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.", 429);
    if (r === "falsch") return consentPage(p, c, false, "Passwort falsch.", 401);
  }
  const code = rand();
  const data: Code = { client: c.id, redirect: p.redirect_uri, challenge: p.code_challenge, scope: SCOPE };
  await kvPut(env, "oauth:code:" + code, JSON.stringify(data), CODE_TTL);
  return back(p, { code });
}

async function issue(env: Env, client: string) {
  const at = rand(), rt = rand();
  await kvPut(env, "oauth:at:" + (await hash(at)), JSON.stringify({ client } satisfies Tok), AT_TTL);
  await kvPut(env, "oauth:rt:" + (await hash(rt)), JSON.stringify({ client } satisfies Tok), RT_TTL);
  // Abgelaufene Einträge aufräumen
  await env.DB.prepare("DELETE FROM kv WHERE key LIKE 'oauth:%' AND expires_at IS NOT NULL AND expires_at < ?").bind(nowS()).run();
  return jsonC({ access_token: at, token_type: "Bearer", expires_in: AT_TTL, refresh_token: rt, scope: SCOPE });
}

export async function token(req: Request, env: Env) {
  if (req.method !== "POST") return oerr("invalid_request", "Nur POST");
  const f = await req.formData().catch(() => null);
  if (!f) return oerr("invalid_request", "Formular erwartet");
  const g = (k: string) => String(f.get(k) || "");
  if (g("grant_type") === "authorization_code") {
    const key = "oauth:code:" + g("code");
    const c = await kvGetJson<Code | null>(env, key, null);
    await kvDelete(env, key);
    if (!c || c.client !== g("client_id") || c.redirect !== g("redirect_uri")) return oerr("invalid_grant", "Code ungültig oder abgelaufen.");
    if (!(await pkceOk(g("code_verifier"), c.challenge))) return oerr("invalid_grant", "PKCE-Prüfung fehlgeschlagen.");
    if (!(await kvGet(env, "oauth:client:" + c.client))) return oerr("invalid_client", "App wurde entfernt.");
    return issue(env, c.client);
  }
  if (g("grant_type") === "refresh_token") {
    const key = "oauth:rt:" + (await hash(g("refresh_token")));
    const t = await kvGetJson<Tok | null>(env, key, null);
    await kvDelete(env, key);
    if (!t || (g("client_id") && g("client_id") !== t.client)) return oerr("invalid_grant", "Erneuerungs-Token ungültig.");
    if (!(await kvGet(env, "oauth:client:" + t.client))) return oerr("invalid_client", "App wurde entfernt.");
    return issue(env, t.client);
  }
  return oerr("unsupported_grant_type", "Nur authorization_code und refresh_token.");
}

/** Zugangs-Token für /mcp prüfen; merkt sich höchstens stündlich, wann die App zuletzt zugegriffen hat */
export async function accessValid(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const t = await kvGetJson<Tok | null>(env, "oauth:at:" + (await hash(auth.slice(7))), null);
  if (!t) return false;
  const c = await kvGetJson<OAuthClient | null>(env, "oauth:client:" + t.client, null);
  if (!c) return false;
  if (!c.lastUsed || Date.now() - Date.parse(c.lastUsed) > 3600e3) {
    c.lastUsed = new Date().toISOString();
    await kvPut(env, "oauth:client:" + c.id, JSON.stringify(c));
  }
  return true;
}
