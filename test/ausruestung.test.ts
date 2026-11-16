// Tests für die Ausrüstung (#52) mit ausgedachten Schuhen und Einheiten.
// Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanItem, emptyStore, gearOf, gearUsage, mergeStravaGear, type GearAct } from "../src/ausruestung.ts";

const athlete = {
  shoes: [{ id: "g111", name: "Tempo-Schuh", distance: 412345, retired: false }, { id: "g222", name: "Alter Schuh", distance: 980000, retired: true }],
  bikes: [{ id: "b333", name: "Rennrad", distance: 5000000 }],
};

test("Strava-Liste übernehmen: neue Teile mit Stand, bekannte aktualisiert, eigene Angaben bleiben", () => {
  let s = mergeStravaGear(emptyStore(), athlete);
  assert.equal(s.items.length, 3);
  const tempo = s.items.find((i) => i.strava === "g111")!;
  assert.equal(tempo.stravaKm, 412.3);
  assert.equal(tempo.limitKm, 700);
  assert.equal(s.items.find((i) => i.strava === "g222")!.retired, true);
  assert.equal(s.items.find((i) => i.strava === "b333")!.limitKm, null);
  tempo.limitKm = 600;
  s = mergeStravaGear(s, { shoes: [{ id: "g111", name: "Tempo-Schuh 2", distance: 420000 }] });
  const again = s.items.find((i) => i.strava === "g111")!;
  assert.equal(again.name, "Tempo-Schuh 2");
  assert.equal(again.stravaKm, 420);
  assert.equal(again.limitKm, 600, "eigene Grenze bleibt");
  assert.equal(s.items.length, 3);
});

test("Kilometerstand: Strava-Stand plus eigene Zuordnungen, eigener Schuh mit Start-Kilometern", () => {
  const s = mergeStravaGear(emptyStore(), athlete);
  s.items.push({ id: "own1", name: "Trailschuh", sport: "run", startKm: 120, limitKm: 700, retired: false });
  const acts: GearAct[] = [
    { id: "1", date: "2026-11-01", km: 10, strava: { gear: "g111" } },          // in Stravas Stand enthalten
    { id: "2", date: "2026-11-03", km: 8 },                                      // nur Garmin, selbst zugeordnet
    { id: "3", date: "2026-11-05", km: 15, strava: { gear: "g111" } },           // Strava sagt Tempo, ich sage Trail
    { id: "s4", date: "2026-11-06", km: 12, src: "strava", gear: "g111" },       // reine Strava-Einheit
    { id: "5", date: "2026-11-07", km: 5, hidden: 1 },                           // ausgeblendet
  ];
  s.assign = { "2": "s-g111", "3": "own1", "5": "own1" };
  assert.equal(gearOf(acts[0], s), "s-g111");
  assert.equal(gearOf(acts[2], s), "own1", "eigene Wahl vor Strava");
  const u = gearUsage(s, acts);
  assert.equal(u["s-g111"].km, 412.3 + 8, "nur die Einheit, die Strava nicht kennt, kommt dazu");
  assert.equal(u["s-g111"].count, 3);
  assert.equal(u["s-g111"].last, "2026-11-06");
  assert.equal(u.own1.km, 135);
  assert.equal(u.own1.count, 1);
});

test("Eingaben prüfen", () => {
  assert.equal(cleanItem({ name: "  " }), "Bitte einen Namen eintragen.");
  assert.match(String(cleanItem({ name: "X", startKm: -5 })), /Kilometerstand/);
  assert.match(String(cleanItem({ name: "X", limitKm: 10 })), /Grenze/);
  const ok = cleanItem({ name: "Neuer Schuh", sport: "run", startKm: "35,0".replace(",", "."), limitKm: "" });
  assert.ok(typeof ok === "object" && ok.startKm === 35 && ok.limitKm === null && ok.retired === false);
});
