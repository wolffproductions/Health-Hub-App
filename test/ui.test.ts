// Prüft, dass sich die Oberfläche aus src/ui/ vollständig und fehlerfrei zusammensetzen lässt.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Script } from "node:vm";
import { assembleUi } from "../src/assemble-ui.ts";

const dir = new URL("../src/ui/", import.meta.url);
const files = readdirSync(dir).filter((f) => f !== "shell.html" && f !== "parts.ts");
// Skript-Teile liegen als *.js.txt vor, heißen im Grundgerüst aber ohne .txt
const key = (f: string) => f.replace(/\.txt$/, "");
const parts = Object.fromEntries(files.map((f) => [key(f), readFileSync(new URL(f, dir), "utf8")]));
const shell = readFileSync(new URL("shell.html", dir), "utf8");

test("jeder Teil hat genau einen Platzhalter, keiner bleibt übrig", () => {
  for (const f of files) assert.equal(shell.split(`<!-- ui:${key(f)} -->`).length - 1, 1, `Platzhalter für ${f}`);
  const html = assembleUi(shell, parts);
  assert.doesNotMatch(html, /<!-- ui:/);
});

test("parts.ts bindet alle Dateien aus src/ui/ ein", () => {
  const list = readFileSync(new URL("parts.ts", dir), "utf8");
  for (const f of files) assert.match(list, new RegExp(`"\\./${f.replace(/\./g, "\\.")}"`), `${f} fehlt in parts.ts`);
});

test("fehlender Teil fällt sofort auf", () => {
  assert.throws(() => assembleUi("<!-- ui:gibtsnicht.js -->\n", {}), /UI-Teil fehlt/);
  assert.throws(() => assembleUi("", { "extra.js": "" }), /ohne Platzhalter/);
});

test("das JavaScript der Seite hat keinen Syntaxfehler", () => {
  const html = assembleUi(shell, parts);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, "kein Inline-Skript gefunden");
  // nur übersetzen, nicht ausführen
  for (const code of scripts) assert.doesNotThrow(() => new Script(code));
});
