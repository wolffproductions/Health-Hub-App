// Tests für Wetter je Einheit (#54), synthetische Antwort im Format von Open-Meteo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coarse, pickHour, windDir, wxKind, wxUrl } from "../src/wetter.ts";

test("Wetter: Ort gerundet, Archiv für ältere Tage", () => {
  assert.equal(coarse(52.51234), 52.5);
  const u = new URL(wxUrl(52.51234, 13.40987, "2026-11-10", "2026-11-18"));
  assert.equal(u.hostname, "api.open-meteo.com");
  assert.equal(u.searchParams.get("latitude"), "52.5");
  assert.equal(u.searchParams.get("longitude"), "13.4");
  assert.equal(new URL(wxUrl(52.5, 13.4, "2026-01-10", "2026-11-18")).hostname, "archive-api.open-meteo.com");
});

test("Wetter: Stunde zur Mitte der Einheit, Code und Windrichtung", () => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const json = { hourly: { time: hours.map((h) => `2026-11-10T${String(h).padStart(2, "0")}:00`), temperature_2m: hours.map((h) => h), apparent_temperature: hours.map((h) => h - 2),
    relative_humidity_2m: hours.map(() => 70), wind_speed_10m: hours.map(() => 18.4), wind_direction_10m: hours.map(() => 225), weather_code: hours.map(() => 61) } };
  // Start 07:30, 60 Minuten → Mitte 08:00
  const w = pickHour(json, "07:30", 60)!;
  assert.deepEqual(w, { t: 8, ta: 6, hu: 70, ws: 18, wd: 225, c: 61 });
  assert.equal(wxKind(w.c).label, "Regen");
  assert.equal(windDir(225), "SW");
  assert.equal(wxKind(0).icon, "sonne");
  assert.equal(pickHour({}, "07:30", 60), null);
});
