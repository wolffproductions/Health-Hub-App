// Tests für die Mitteilungs-Arten und die Meldung zu neuen Funktionen (#161). Ausführen: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOn, kindsOf, newsStep, newsText } from "../src/mitteilungen.ts";

test("Mitteilungen: Arten nur mit eingeschaltetem Push, Standard wie vor #161", () => {
  assert.equal(kindOn({ on: false }, "morgen"), false);
  assert.equal(kindOn({ on: true }, "morgen"), true);
  assert.equal(kindOn({ on: true }, "freunde"), true);
  assert.equal(kindOn({ on: true }, "neu"), false);
  assert.equal(kindOn({ on: true, kinds: { morgen: false, neu: true } }, "morgen"), false);
  assert.equal(kindOn({ on: true, kinds: { morgen: false, neu: true } }, "neu"), true);
  assert.deepEqual(kindsOf({ on: false, kinds: { freunde: false } }), { morgen: true, freunde: false, neu: false, wetter: false });
  // Rad-Wetter (#153): nur auf Wunsch
  assert.equal(kindOn({ on: true }, "wetter"), false);
  assert.equal(kindOn({ on: true, kinds: { wetter: true } }, "wetter"), true);
});

test("Neue Funktionen: erst merken, dann nur Neues und nur tagsüber melden", () => {
  const ids = ["2026-11-22", "2026-11-21", "2026-11-20"];
  assert.equal(newsStep({ on: true }, ids, "12:00"), "nichts"); // Art aus
  assert.equal(newsStep({ on: false, kinds: { neu: true } }, ids, "12:00"), "nichts"); // Push aus
  assert.equal(newsStep({ on: true, kinds: { neu: true } }, ids, "12:00"), "merken"); // gerade eingeschaltet
  assert.equal(newsStep({ on: true, kinds: { neu: true }, newsSent: "2026-11-22" }, ids, "12:00"), "nichts");
  assert.equal(newsStep({ on: true, kinds: { neu: true }, newsSent: "2026-11-20" }, ids, "12:00"), "senden");
  assert.equal(newsStep({ on: true, kinds: { neu: true }, newsSent: "2026-11-20" }, ids, "06:30"), "nichts"); // Nacht
  assert.equal(newsStep({ on: true, kinds: { neu: true }, newsSent: "2026-11-20" }, ids, "21:30"), "nichts");
  assert.equal(newsStep({ on: true, kinds: { neu: true }, newsSent: "2026-11-20" }, [], "12:00"), "nichts");
});

test("Neue Funktionen: Text nennt den neuesten Eintrag und zählt die übrigen", () => {
  const e = [{ id: "c", titel: "Karte in 3D" }, { id: "b", titel: "Teilen" }, { id: "a", titel: "Alt" }];
  assert.deepEqual(newsText(e, "b"), { title: "Neu in deiner App", body: "Karte in 3D. Tippe für Details." });
  assert.equal(newsText(e, "a").body, "Karte in 3D (und 1 weitere Neuerung). Tippe für Details.");
  assert.equal(newsText([{ id: "d", titel: "X" }, ...e], "a").body, "X (und 2 weitere Neuerungen). Tippe für Details.");
  // gemerkter Eintrag gibt es nicht mehr (alte Liste gekürzt): nur den neuesten melden
  assert.equal(newsText(e, "zz").body, "Karte in 3D. Tippe für Details.");
});
