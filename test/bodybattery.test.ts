// Tests für Body Battery: aktueller Stand und Tagesverlauf (#79). Nur ausgedachte Werte.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBodyBatteryCurves, extractDailySummaries } from "../src/garmin/extract.ts";

test("Body Battery: aktueller Stand und Wert beim Aufwachen aus den Tageswerten", () => {
  const rows = extractDailySummaries({ data: [{ calendarDate: "2026-11-10", bodyBattery: { maxValue: 100, minValue: 40, latestValue: 62 } }] });
  const m = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
  assert.equal(m.bbNow, 62);
  assert.equal(m.bbMax, 100);
  const v1 = extractDailySummaries([{ calendarDate: "2026-11-10", bodyBatteryMostRecentValue: 55, bodyBatteryAtWakeTime: 88 }]);
  const m1 = Object.fromEntries(v1.map((r) => [r.metric, r.value]));
  assert.equal(m1.bbNow, 55);
  assert.equal(m1.bbWake, 88);
});

test("Body Battery: Tagesverlauf in Ortszeit, Spalten laut Beschreibung, ungültige Werte übersprungen", () => {
  const midnightUtc = Date.parse("2026-11-10T00:00:00Z");
  // Ortszeit = UTC + 1 h; Messpunkte um 06:00, 12:30 und 18:00 Ortszeit
  const at = (h: number, m: number) => midnightUtc + ((h - 1) * 60 + m) * 60000;
  const curves = extractBodyBatteryCurves([{
    date: "2026-11-10",
    startTimestampGMT: "2026-11-09T23:00:00.0",
    startTimestampLocal: "2026-11-10T00:00:00.0",
    // absichtlich andere Reihenfolge der Spalten: Stand vorn, Zeit hinten
    bodyBatteryValueDescriptorDTOList: [
      { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: "bodyBatteryLevel" },
      { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: "timestamp" },
    ],
    bodyBatteryValuesArray: [[45, at(18, 0)], [92, at(6, 0)], [null, at(9, 0)], [70, at(12, 30)]],
  }]);
  assert.equal(curves.length, 1);
  assert.equal(curves[0].day, "2026-11-10");
  assert.deepEqual(curves[0].pts, [[360, 92], [750, 70], [1080, 45]]);
});

test("Body Battery: leere oder unbekannte Antwort ergibt keinen Verlauf", () => {
  assert.deepEqual(extractBodyBatteryCurves(null), []);
  assert.deepEqual(extractBodyBatteryCurves([{ date: "2026-11-10" }]), []);
});
