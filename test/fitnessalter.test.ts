// Tests für das Fitnessalter (#78). Nur ausgedachte Werte.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFitnessAge } from "../src/garmin/extract.ts";

test("Fitnessalter: neuester Eintrag, Bausteine nach Priorität", () => {
  const fa = extractFitnessAge([
    { chronologicalAge: 40, fitnessAge: 36.2, lastUpdated: "2026-10-01T08:00:00.0" },
    {
      chronologicalAge: 40, fitnessAge: 34.44, achievableFitnessAge: 31.2, previousFitnessAge: 35.1,
      lastUpdated: "2026-11-08T07:30:00.0",
      components: {
        rhr: { value: 52, targetValue: 49, potentialAge: 33.1, priority: 2, stale: false },
        vigorousDaysAvg: { value: 2.25, targetValue: 4, potentialAge: 32.4, priority: 1 },
        bmi: { value: 23.4, targetValue: 23.4, potentialAge: 34.4, priority: 3, stale: true },
      },
    },
  ]);
  assert.ok(fa);
  assert.equal(fa.day, "2026-11-08");
  assert.equal(fa.chrono, 40);
  assert.equal(fa.fit, 34.4);
  assert.equal(fa.ach, 31.2);
  assert.equal(fa.prev, 35.1);
  assert.deepEqual(fa.comps.map((c) => c.key), ["vigorousDaysAvg", "rhr", "bmi"]);
  assert.equal(fa.comps[0].value, 2.3);
  assert.equal(fa.comps[2].stale, true);
});

test("Fitnessalter: Grund, wenn Garmin keins berechnet; leere Antwort ergibt nichts", () => {
  const fa = extractFitnessAge([{ invalidReason: "USER_EMPTY_AGE" }]);
  assert.equal(fa?.invalid, "USER_EMPTY_AGE");
  assert.equal(fa?.fit, null);
  assert.equal(extractFitnessAge(null), null);
  assert.equal(extractFitnessAge([]), null);
});
