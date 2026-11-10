// Anmeldung mit Passkey (#95): Routen und Speicher. Die eigentliche Prüfung steht in webauthn.ts.
//
// Gespeichert werden nur öffentliche Schlüssel (kv „passkeys“), nichts Geheimes. Die Challenge
// ist HMAC-signiert statt gespeichert; nach erfolgreicher Anmeldung wird sie als verbraucht
// vermerkt, damit dieselbe Antwort nicht zweimal angenommen wird.
import type { Env } from "./env";
import { noteFail, sessionCookie, tooManyFails } from "./auth";
import { hmacKey, json, kvDelete, kvGet, kvGetJson, kvPut, respond } from "./util";
import { checkChallenge, ES256, makeChallenge, RS256, toB64u, verifyAssertion, verifyRegistration, type Credential } from "./webauthn";

const MAX_PASSKEYS = 10;

interface Stored extends Credential { name: string; created: string; used: string | null }

const list = (env: Env) => kvGetJson<Stored[]>(env, "passkeys", []);
const save = (env: Env, keys: Stored[]) => kvPut(env, "passkeys", JSON.stringify(keys));

export async function hasPasskeys(env: Env): Promise<boolean> {
  return (await list(env)).length > 0;
}

/** Fester, zufälliger Benutzer-Kennwert der Instanz (user.id bei WebAuthn), einmal erzeugt. */
async function userHandle(env: Env): Promise<string> {
  let h = await kvGet(env, "passkeyUser");
  if (!h) { h = toB64u(crypto.getRandomValues(new Uint8Array(16))); await kvPut(env, "passkeyUser", h); }
  return h;
}

const expect = (url: URL, challenge: string) => ({ challenge, origin: url.origin, rpId: url.hostname });
const str = (v: unknown, max = 4096) => (typeof v === "string" && v.length <= max ? v : "");
const cleanName = (v: unknown) => str(v, 200).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Gerät";

// ---------- Öffentlich: Anmeldung ----------

export async function passkeyLoginOptions(env: Env): Promise<Response> {
  return json({ challenge: await makeChallenge(await hmacKey(env), "auth"), timeout: 120000, userVerification: "required" });
}

export async function passkeyLogin(req: Request, url: URL, env: Env): Promise<Response> {
  if (await tooManyFails(env)) return json({ error: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen." }, 429);
  const b = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const challenge = str(b.challenge, 200);
  const fail = async (msg: string) => { await noteFail(env); return json({ error: msg }, 401); };

  if (!(await checkChallenge(await hmacKey(env), "auth", challenge))) return fail("Anfrage abgelaufen. Bitte noch einmal versuchen.");
  if (await kvGet(env, "pkUsed:" + challenge)) return fail("Anfrage schon verwendet. Bitte noch einmal versuchen.");
  const keys = await list(env);
  const cred = keys.find((k) => k.id === str(b.id, 1400));
  if (!cred) return fail("Dieser Passkey ist hier nicht (mehr) eingetragen.");
  try {
    const { counter } = await verifyAssertion(
      { authenticatorData: str(b.authenticatorData), clientDataJSON: str(b.clientDataJSON), signature: str(b.signature) },
      cred, expect(url, challenge),
    );
    cred.counter = counter;
    cred.used = new Date().toISOString();
  } catch (e) {
    return fail("Passkey nicht akzeptiert: " + (e as Error).message);
  }
  await kvPut(env, "pkUsed:" + challenge, "1", 600);
  await env.DB.prepare("DELETE FROM kv WHERE key LIKE 'pkUsed:%' AND expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
  await save(env, keys);
  await kvDelete(env, "loginFails");
  return respond(JSON.stringify({ ok: true }), 200, "application/json; charset=utf-8", { "Set-Cookie": await sessionCookie(env) });
}

// ---------- Angemeldet: Passkeys verwalten (Konto → Anmeldung) ----------

export async function passkeyRoute(req: Request, url: URL, env: Env, sub: string): Promise<Response> {
  if (sub === "" && req.method === "GET") {
    return json((await list(env)).map(({ id, name, created, used, synced }) => ({ id, name, created, used, synced })));
  }
  if (sub === "options" && req.method === "POST") {
    const keys = await list(env);
    if (keys.length >= MAX_PASSKEYS) return json({ error: `Höchstens ${MAX_PASSKEYS} Passkeys. Entferne zuerst einen alten.` }, 400);
    return json({
      challenge: await makeChallenge(await hmacKey(env), "reg"),
      rp: { id: url.hostname, name: "Health Hub" },
      user: { id: await userHandle(env), name: url.hostname, displayName: "Health Hub" },
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }, { type: "public-key", alg: RS256 }],
      timeout: 120000,
      attestation: "none",
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: keys.map((k) => ({ type: "public-key", id: k.id })),
    });
  }
  if (sub === "" && req.method === "POST") {
    const b = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const challenge = str(b.challenge, 200);
    if (!(await checkChallenge(await hmacKey(env), "reg", challenge))) return json({ error: "Anfrage abgelaufen. Bitte noch einmal versuchen." }, 400);
    const keys = await list(env);
    if (keys.length >= MAX_PASSKEYS) return json({ error: `Höchstens ${MAX_PASSKEYS} Passkeys.` }, 400);
    let cred: Credential;
    try {
      cred = await verifyRegistration(
        { id: str(b.id, 1400), attestationObject: str(b.attestationObject, 16384), clientDataJSON: str(b.clientDataJSON) },
        expect(url, challenge),
      );
    } catch (e) {
      return json({ error: "Passkey konnte nicht angelegt werden: " + (e as Error).message }, 400);
    }
    if (keys.some((k) => k.id === cred.id)) return json({ error: "Dieser Passkey ist schon eingetragen." }, 409);
    keys.push({ ...cred, name: cleanName(b.name), created: new Date().toISOString(), used: null });
    await save(env, keys);
    return json({ ok: true });
  }
  if (sub === "" && req.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    const keys = await list(env);
    const rest = keys.filter((k) => k.id !== id);
    if (rest.length === keys.length) return json({ error: "Nicht gefunden" }, 404);
    await save(env, rest);
    return json({ ok: true });
  }
  return json({ error: "Nicht gefunden" }, 404);
}
