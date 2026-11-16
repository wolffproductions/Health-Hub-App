// Automatisches Deploy (Workers Builds): Konfiguration aus Build-Variablen, nur mit Beispiel-IDs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/auto-deploy.mjs");
const BEISPIEL_ID = "11111111-2222-4333-8444-555555555555";

function inOrdner(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "autodeploy-"));
  cpSync("wrangler.jsonc", join(dir, "wrangler.jsonc"));
  try {
    execFileSync(process.execPath, [SCRIPT, "--nur-config"], { cwd: dir, env: { PATH: process.env.PATH ?? "", ...env }, stdio: "pipe" });
    return { ok: true, cfg: readFileSync(join(dir, "wrangler.local.jsonc"), "utf8") };
  } catch {
    return { ok: false, cfg: "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Auto-Deploy: setzt die D1-ID aus der Build-Variable ein", () => {
  const r = inOrdner({ D1_ID: BEISPIEL_ID });
  assert.ok(r.ok);
  assert.ok(r.cfg.includes(`"database_id": "${BEISPIEL_ID}"`));
  assert.ok(!r.cfg.includes("HIER_D1_ID_EINTRAGEN"));
  assert.ok(!/"r2_buckets"\s*:/.test(r.cfg.replace(/\/\/.*$/gm, "")));
});

test("Auto-Deploy: bricht ohne oder mit falscher D1-ID ab", () => {
  assert.equal(inOrdner({}).ok, false);
  assert.equal(inOrdner({ D1_ID: "nicht-gueltig" }).ok, false);
});

test("Auto-Deploy: R2-Bucket optional", () => {
  const r = inOrdner({ D1_ID: BEISPIEL_ID, FILES_BUCKET: "health-hub-files" });
  assert.ok(r.ok);
  assert.ok(r.cfg.includes('"r2_buckets": [{ "binding": "FILES", "bucket_name": "health-hub-files" }]'));
  assert.equal(inOrdner({ D1_ID: BEISPIEL_ID, FILES_BUCKET: "Bös artig" }).ok, false);
});
