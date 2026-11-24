// „Was ist neu?“ (#91): jede id nur einmal, sonst sieht man einen Eintrag nie (passiert leicht bei parallelen PRs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEWS } from "../src/neuigkeiten.ts";

test("Neuigkeiten: jede id ist eindeutig und hat Text", () => {
  const ids = NEWS.map((n) => n.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], "doppelte id: " + dup.join(", "));
  for (const n of NEWS) assert.ok(n.titel && n.punkte.length, n.id);
});
