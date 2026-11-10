// Tests für Withings (#3). Nur ausgedachte Werte.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extractMeasures, sign } from "../src/withings/extract.ts";

test("Withings: Messwerte mit Einheit, letzte Messung pro Tag, Ortszeit, Ziele ignoriert", () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  const rows = extractMeasures({
    timezone: "Europe/Berlin",
    measuregrps: [
      // 23:30 UTC = 00:30 in Berlin → zählt zum nächsten Tag
      { date: t("2026-11-07T23:30:00Z"), category: 1, measures: [{ value: 78450, type: 1, unit: -3 }] },
      { date: t("2026-11-07T06:10:00Z"), category: 1, measures: [{ value: 7900, type: 1, unit: -2 }, { value: 182, type: 6, unit: -1 }] },
      { date: t("2026-11-07T19:00:00Z"), category: 1, measures: [{ value: 7820, type: 1, unit: -2 }, { value: 6041, type: 76, unit: -2 }] },
      { date: t("2026-11-07T20:00:00Z"), category: 2, measures: [{ value: 75000, type: 1, unit: -3 }] },
      { date: t("2026-11-07T20:00:00Z"), category: 1, measures: [{ value: 120, type: 10, unit: 0 }] },
    ],
  });
  const m = Object.fromEntries(rows.map((r) => [r.day + " " + r.metric, r.value]));
  assert.deepEqual(m, {
    "2026-11-07 kg": 78.2,
    "2026-11-07 fat": 18.2,
    "2026-11-07 muscle": 60.41,
    "2026-11-08 kg": 78.45,
  });
});

test("Withings: leere oder fehlerhafte Antwort ergibt keine Werte", () => {
  assert.deepEqual(extractMeasures(null), []);
  assert.deepEqual(extractMeasures({ measuregrps: [{ date: "gestern", measures: [] }] }), []);
});

test("Withings: Signatur = HMAC-SHA256 über die nach Namen sortierten Werte", async () => {
  const sig = await sign("geheim", { nonce: "n1", action: "requesttoken", client_id: "abc" });
  assert.equal(sig, createHmac("sha256", "geheim").update("requesttoken,abc,n1").digest("hex"));
});
