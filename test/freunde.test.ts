// Tests für Freunde und Rangliste (#87), synthetische Daten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanSummary, DEFAULT_SHARE, MAX_ACTS, parseLink, shareRoute, summarize, weightAt } from "../src/freunde.ts";

const acts = [
  { date: "2026-11-16", type: "running", km: 10, min: 50, elev: 100, bst: { d: { "5000": 1300, "1000": 250 }, p: {} } },
  { date: "2026-11-10", type: "running", km: 5, min: 25, elev: 20, f5k: 1250 },
  { date: "2025-12-20", type: "running", km: 21, min: 110, elev: 300, bst: { d: { "5000": 1200 } } },
  { date: "2026-11-15", type: "road_biking", km: 60, min: 120, elev: 600, bst: { d: { "50000": 6000 }, p: { "1200": 250, "5": 800 } } },
  { date: "2026-11-17", type: "running", km: 8, min: 40, src: "strava" },
  { date: "2026-11-17", type: "running", km: 7, min: 35, src: "whoop" },
];

test("Freunde: ohne Freigabe nur der Name, nie Strava- oder WHOOP-Einheiten", () => {
  const s = summarize(acts, DEFAULT_SHARE, { name: "Alex", img: "data:image/jpeg;base64,AA" }, "2026-11-18", 52);
  assert.deepEqual({ name: s.name, run: s.run, ride: s.ride, img: s.img, vo2: s.vo2 }, { name: "Alex", run: undefined, ride: undefined, img: undefined, vo2: undefined });
  const all = summarize(acts, { umfang: true, best: true, watt: true, vo2: true, bild: true, akt: false }, { name: "Alex" }, "2026-11-18", 52);
  // Woche ab Montag 16.11.: nur der 10-km-Lauf (Strava/WHOOP vom 17.11. zählen nicht)
  assert.deepEqual(all.run!.w, { km: 10, h: 0.8, hm: 100, n: 1 });
  assert.equal(all.run!.m!.km, 15);
  assert.equal(all.run!.y!.n, 2);
  // Bestzeit 5 km: gesamt 1200 (Dez. 2025), dieses Jahr 1250 (Garmins Wert als Ausweich ohne .fit)
  assert.equal(all.run!.best!.all["5000"], 1200);
  assert.equal(all.run!.best!.year["5000"], 1250);
  assert.equal(all.ride!.watt!.all["1200"], 250);
  assert.equal(all.run!.watt, undefined);
  assert.equal(all.vo2, 52);
});

test("Freunde: W/kg mit dem Gewicht zur Zeit der Fahrt", () => {
  const w = [{ d: "2026-01-10", kg: 90 }, { d: "2026-11-01", kg: 80 }];
  assert.equal(weightAt(w, "2026-11-15"), 80);
  assert.equal(weightAt(w, "2026-01-20"), 90);
  assert.equal(weightAt(w, "2026-06-01"), 90); // keine Messung in 30 Tagen: letzte davor
  const s = summarize(acts, { ...DEFAULT_SHARE, watt: true }, { name: "A" }, "2026-11-18", null, w);
  // 20 min: 250 W bei 80 kg = 3,13 W/kg; 5 s: 800 W = 10 W/kg
  assert.equal(s.ride!.wkg!.all["1200"], 3.13);
  assert.equal(s.ride!.wkg!.all["5"], 10);
  // ohne Gewicht kein W/kg
  assert.equal(summarize(acts, { ...DEFAULT_SHARE, watt: true }, { name: "A" }, "2026-11-18").ride!.wkg, undefined);
});

test("Freunde: Link prüfen und fremde Zusammenfassung säubern", () => {
  const t = "a".repeat(43);
  assert.deepEqual(parseLink("https://hub.example.workers.dev/f/" + t), { origin: "https://hub.example.workers.dev", token: t });
  assert.equal(parseLink("http://evil.example/f/" + t), null);
  assert.equal(parseLink("https://x.example/f/kurz"), null);
  const c = cleanSummary({ v: 1, name: "Bea", run: { w: { km: 12, h: 1, hm: 50, n: 2, x: 9 }, best: { all: { "5000": 1400, "<script>": 1 } } }, evil: "x", img: "javascript:1" })!;
  assert.equal(c.name, "Bea");
  assert.deepEqual(c.run!.w, { km: 12, h: 1, hm: 50, n: 2 });
  assert.deepEqual(c.run!.best!.all, { "5000": 1400 });
  assert.equal((c as any).evil, undefined);
  assert.equal(c.img, undefined);
  assert.equal(cleanSummary({ name: "x" }), null);
});

test("Freunde: Abruf nutzt nur Weiterleitungs-Einstellungen, die Cloudflare Workers kennen", () => {
  // „error“ gibt es in Workers nicht und ließ jedes Folgen scheitern (Fehler „Invalid redirect value“)
  const src = readFileSync(new URL("../src/freunde-api.ts", import.meta.url), "utf8");
  assert.ok(!/redirect:\s*"error"/.test(src));
  assert.ok(/redirect:\s*"manual"/.test(src));
});

// synthetische Route: 5 km gerade nach Norden, alle ~10 m ein Punkt (0,00009° ≈ 10 m)
const line = (n: number) => Array.from({ length: n }, (_, i) => [48 + i * 0.00009, 16.3] as [number, number]);

test("Freunde: Route ohne die ersten und letzten 200 m, ausgedünnt, kurze Routen gar nicht", () => {
  const r = shareRoute(line(500))!;
  assert.ok(r.length <= 201 && r.length > 50, "Punkte " + r.length);
  // erster geteilter Punkt mindestens ~200 m vom echten Start, letzter ~200 m vom Ende
  assert.ok((r[0][0] - 48) / 0.00009 >= 19, "Start gekürzt");
  assert.ok((48 + 499 * 0.00009 - r[r.length - 1][0]) / 0.00009 >= 19, "Ende gekürzt");
  assert.equal(shareRoute(line(100)), undefined, "1 km Route: nach dem Kürzen zu kurz");
  assert.equal(shareRoute("kaputt"), undefined);
});

test("Freunde: letzte Aktivitäten nur mit Freigabe, ohne Strava, höchstens 10, Route gekürzt", () => {
  const acts = Array.from({ length: 14 }, (_, i) => ({ id: "g" + i, date: "2026-11-" + String(i + 1).padStart(2, "0"), type: "running", name: "Lauf " + i, km: 10, min: 50, rt: 1 }));
  acts.push({ id: "s1", date: "2026-11-15", type: "running", name: "Strava", km: 5, min: 25, rt: 1, src: "strava" } as any);
  const routes = { g13: line(500) };
  assert.equal(summarize(acts, DEFAULT_SHARE, { name: "A" }, "2026-11-18", null, [], routes).acts, undefined);
  const s = summarize(acts, { ...DEFAULT_SHARE, akt: true }, { name: "A" }, "2026-11-18", null, [], routes);
  assert.equal(s.acts!.length, MAX_ACTS);
  assert.equal(s.acts![0].id, "g13", "neueste zuerst");
  assert.ok(!s.acts!.some((a) => a.id === "s1"), "keine Strava-Einheit");
  assert.ok(s.acts![0].route!.length > 50);
  // Empfänger prüft: unbekannte Felder weg, Koordinaten nur gültige
  const back = cleanSummary({ ...s, acts: [...s.acts!, { id: "x", date: "kein Datum" }].map((a, i) => (i === 1 ? { ...a, route: [[999, 1], [48, 16], [48.1, 16.1]], evil: "<script>" } : a)) })!;
  assert.equal(back.acts!.length, MAX_ACTS);
  assert.deepEqual(back.acts![1].route, [[48, 16], [48.1, 16.1]]);
  assert.equal((back.acts![1] as any).evil, undefined);
});

test("Freunde: Anzahl Follower/Gefolgt wird übernommen, Unsinn nicht", () => {
  const ok = cleanSummary({ v: 1, name: "A", at: "", fol: 3, fing: 2 })!;
  assert.equal(ok.fol, 3); assert.equal(ok.fing, 2);
  const bad = cleanSummary({ v: 1, name: "A", at: "", fol: -1, fing: "viele" })!;
  assert.equal(bad.fol, undefined); assert.equal(bad.fing, undefined);
});
