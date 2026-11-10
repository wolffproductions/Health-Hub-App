// Tests für den Claude-Zugang (#5): JSON-RPC, PKCE, Rückleitungsadressen. Nur ausgedachte Werte.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleBody, handleRpc, pkceOk, redirectAllowed, ToolError, type McpTool } from "../src/mcp/server.ts";

const tools: McpTool<{ n: number }>[] = [
  { name: "echo", title: "Echo", description: "gibt n zurück", inputSchema: { type: "object" }, run: async (ctx, args) => ({ n: ctx.n, args }) },
  { name: "kaputt", title: "Kaputt", description: "", inputSchema: { type: "object" }, run: async () => { throw new ToolError("Datum ungültig"); } },
  { name: "intern", title: "Intern", description: "", inputSchema: { type: "object" }, run: async () => { throw new Error("SQL geheim"); } },
];
const ctx = { n: 7 };

test("MCP: initialize nennt Version, Werkzeuge und Hinweise", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, tools, ctx);
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.ok(r.result.capabilities.tools);
  assert.equal(r.result.serverInfo.name, "health-hub");
  const r2: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, tools, ctx);
  assert.equal(r2.result.protocolVersion, "2025-06-18");
});

test("MCP: tools/list ist nur lesend markiert, tools/call liefert Text", async () => {
  const l: any = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, tools, ctx);
  assert.equal(l.result.tools.length, 3);
  assert.equal(l.result.tools[0].annotations.readOnlyHint, true);
  const c: any = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } }, tools, ctx);
  assert.deepEqual(JSON.parse(c.result.content[0].text), { n: 7, args: { a: 1 } });
});

test("MCP: Fehler – eigene Meldung sichtbar, interne nicht, unbekannte Methode", async () => {
  const k: any = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "kaputt" } }, tools, ctx);
  assert.equal(k.result.isError, true);
  assert.equal(k.result.content[0].text, "Datum ungültig");
  const i: any = await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "intern" } }, tools, ctx);
  assert.doesNotMatch(i.result.content[0].text, /SQL/);
  const u: any = await handleRpc({ jsonrpc: "2.0", id: 7, method: "gibtsnicht" }, tools, ctx);
  assert.equal(u.error.code, -32601);
});

test("MCP: Benachrichtigungen ohne Antwort, Listen werden einzeln beantwortet", async () => {
  assert.equal(await handleBody({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, ctx), null);
  const out: any = await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 9, method: "ping" }], tools, ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 9);
});

test("OAuth: PKCE S256 und erlaubte Rückleitungsadressen", async () => {
  const verifier = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFG";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(await pkceOk(verifier, challenge), true);
  assert.equal(await pkceOk(verifier + "x", challenge), false);
  assert.equal(await pkceOk("kurz", challenge), false);
  assert.equal(redirectAllowed("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectAllowed("http://localhost:33418/callback"), true);
  assert.equal(redirectAllowed("http://example.com/cb"), false);
  assert.equal(redirectAllowed("javascript:alert(1)"), false);
});
