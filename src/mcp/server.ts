// MCP-Server (#5): JSON-RPC 2.0 über „Streamable HTTP“, ohne Sitzungen und ohne Server-Sent Events.
// Reine Funktionen ohne Laufzeit-Importe, damit sie in test/mcp.test.ts ohne Worker getestet werden können.
// Spezifikation: https://modelcontextprotocol.io/specification/2025-06-18

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpTool<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: C, args: Record<string, unknown>) => Promise<unknown>;
}

interface RpcMsg { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

/** Fehler, deren Text Claude sehen darf (z. B. „Datum ungültig“); andere werden allgemein gemeldet */
export class ToolError extends Error {}

const INSTRUCTIONS =
  "Persönliche Gesundheits- und Trainingsdaten einer einzelnen Person aus ihrer eigenen Health-Hub-Instanz " +
  "(Garmin, Strava, Withings). Nur lesend. Datumsangaben im Format JJJJ-MM-TT, Ortszeit der Person. " +
  "Für einen schnellen Überblick zuerst get_overview. Keine medizinischen Diagnosen stellen; " +
  "die Erholungs-Ampel ist eine eigene, offengelegte Regel der App, keine Garmin-Berechnung.";

const ok = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Eine JSON-RPC-Nachricht beantworten; Benachrichtigungen (ohne id) ergeben null */
export async function handleRpc<C>(msg: RpcMsg, tools: McpTool<C>[], ctx: C, version = "1.0.0"): Promise<object | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg?.id, -32600, "Ungültige Anfrage");
  }
  const isNote = msg.id === undefined || msg.id === null;
  if (isNote) return null;
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "health-hub", title: "Health Hub", version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: tools.map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === p.name);
      if (!tool) return err(msg.id, -32602, "Unbekanntes Werkzeug: " + String(p.name));
      try {
        const out = await tool.run(ctx, p.arguments && typeof p.arguments === "object" ? p.arguments : {});
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : "Interner Fehler beim Lesen der Daten.";
        return ok(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return err(msg.id, -32601, "Unbekannte Methode: " + msg.method);
  }
}

/** HTTP-Körper (einzelne Nachricht oder Liste) beantworten; null = nur Benachrichtigungen (HTTP 202) */
export async function handleBody<C>(body: unknown, tools: McpTool<C>[], ctx: C, version?: string): Promise<object | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, tools, ctx, version)))).filter((x) => x);
    return out.length ? out : null;
  }
  return handleRpc(body as RpcMsg, tools, ctx, version);
}

/** PKCE (S256): base64url(SHA-256(code_verifier)) muss der code_challenge entsprechen */
export async function pkceOk(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let s = "";
  for (const b of h) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === challenge;
}

/** Erlaubte Rückleitungsadressen für Apps, die sich selbst anmelden: https oder lokal (Claude Code) */
export function redirectAllowed(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}
