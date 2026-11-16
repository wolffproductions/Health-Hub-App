// „Was ist neu?“ (#91): Hinweis beim Öffnen der App nach einem Update. Neueste Einträge oben.
// Jede sichtbare Änderung bekommt hier eine kurze Zeile (Du-Form, aus Sicht der Nutzerin, ohne Technik).
// Neue Version = neuer Eintrag mit neuer `id` (Datum, bei mehreren am Tag mit Buchstabe: 2026-11-12b).
export interface NewsEntry { id: string; titel: string; punkte: string[] }

export const NEWS: NewsEntry[] = [
  {
    id: "2026-11-17",
    titel: "WHOOP verbinden",
    punkte: [
      "Unter Konto → Datenquellen kannst du jetzt dein WHOOP-Band verbinden. Recovery, Schlaf, HRV, Ruhepuls, Strain und deine Einheiten kommen dann automatisch.",
      "Auf „Heute“ siehst du deine WHOOP-Recovery und deinen Strain. Die Ampel funktioniert auch nur mit WHOOP und rechnet dann mit deinem eigenen HRV-Normalbereich.",
      "Trägst du Garmin-Uhr und WHOOP-Band zusammen, wählst du, woher Schlaf und HRV kommen. Doppelte Einheiten zeigt die App nur einmal, mit dem WHOOP-Strain dazu.",
    ],
  },
  {
    id: "2026-11-16d",
    titel: "Prognose lernt aus Wettkämpfen",
    punkte: [
      "Eine harte Zeit der letzten 8 Wochen, etwa ein 5-km-Rennen, zählt jetzt am stärksten für deine Wettkampfprognosen. Über dieselbe Strecke ist die Prognose nie langsamer als das, was du gelaufen bist.",
      "Markierst du eine Einheit in Strava als Wettkampf, steht bei ihr jetzt „Wettkampf“ statt zum Beispiel „VO2max“.",
    ],
  },
  {
    id: "2026-11-16c",
    titel: "Ausrüstung: Schuhe und Räder",
    punkte: [
      "Unter Einheiten ganz unten siehst du jetzt deine Schuhe und Räder mit Kilometerstand. Bei Laufschuhen zeigt ein Balken, wie viel bis zur Grenze fehlt (Standard 700 km).",
      "Ist Strava verbunden, kommen deine Schuhe und Räder samt Kilometerstand automatisch von dort. Eigene legst du selbst an, mit dem bisherigen Kilometerstand.",
      "Auf der Seite einer Einheit wählst du, mit welchem Schuh oder Rad du unterwegs warst.",
    ],
  },
  {
    id: "2026-11-16b",
    titel: "Namen aus Strava",
    punkte: [
      "Ist Strava verbunden, zeigen deine Einheiten den Titel, den du in Strava vergeben hast, statt Garmins Standardnamen wie „Wien Laufen“. Stravas automatische Namen wie „Morgenlauf“ ersetzen ihn nicht.",
    ],
  },
  {
    id: "2026-11-16",
    titel: "Erholungs-Ampel gerechter",
    punkte: [
      "Die HRV zählt jetzt wie bei Garmin über deinen Wochenschnitt. Eine einzelne niedrige Nacht, etwa nach einem Wettkampf, macht die Ampel höchstens gelb statt gleich rot.",
      "Neu dabei ist deine Schlafdauer: unter 6:30 Stunden gelb, unter 5 Stunden rot, auch wenn der Schlafscore gut aussieht.",
    ],
  },
  {
    id: "2026-11-13f",
    titel: "Überblick unter Einheiten",
    punkte: [
      "Unter Einheiten siehst du jetzt deine Summen je Sportart für 4 Wochen, dieses Jahr oder gesamt, dazu deine Wochenserie und Rekorde wie längster Lauf und längste Fahrt.",
      "Tipp auf eine Sportart, dann klappen die einzelnen Einheiten auf. Die lange Liste darunter gibt es nicht mehr.",
    ],
  },
  {
    id: "2026-11-13e",
    titel: "Fitness und Form",
    punkte: [
      "Neu unter Statistiken → Training: Fitness, Ermüdung und Form wie bei TrainingPeaks oder Strava, aus deiner Garmin-Trainingslast berechnet. So siehst du, ob du gerade frisch bist oder im Aufbau.",
    ],
  },
  {
    id: "2026-11-13d",
    titel: "Heute: VO2max und Aktualisieren",
    punkte: [
      "Auf „Heute“ siehst du jetzt deine VO2max mit Datum und Verlauf. Antippen öffnet das Diagramm.",
      "Unter den Kacheln gibt es „Aktualisieren“ mit „Zuletzt aktualisiert …“. Es holt alle verbundenen Quellen.",
      "VO2max selbst eintragen findest du jetzt direkt bei der VO2max unter Statistiken → Leistung statt im Konto.",
    ],
  },
  {
    id: "2026-11-13c",
    titel: "Ampel genauer",
    punkte: [
      "Die Erholung nach Training zeigt jetzt den Stand zur aktuellen Uhrzeit statt vom Morgen der letzten Nacht.",
      "HRV im Normalbereich ist grün, wie bei Garmin („ausgeglichen“). Gelb erst darunter, rot mehr als 10 % darunter.",
    ],
  },
  {
    id: "2026-11-13b",
    titel: "Ampel mit Erholungszeit",
    punkte: [
      "Die Erholungs-Ampel auf „Heute“ kennt jetzt die Erholungszeit nach harten Einheiten: Nach einem harten Intervalltraining zeigt sie am nächsten Morgen „Moderat trainieren“, auch wenn du gut geschlafen hast.",
      "Dazu kommt deine Body Battery beim Aufwachen. Unter „Details“ steht, wie viele Stunden Erholung noch offen sind.",
    ],
  },
  {
    id: "2026-11-13",
    titel: "Wettkampfprognosen für alle",
    punkte: [
      "Die Prognose unter Statistiken → Leistung erkennt jetzt, ob du wirklich Intervalle gelaufen bist. Normale Läufe mit Kilometer-Runden zählen nicht mehr als Intervalle.",
      "Zeit groß, darunter dein Tempo pro Kilometer. Woraus gerechnet wird, steht als kleine Marken darunter, die Details unter „Wie wird das berechnet?“.",
      "Unter Konto → Wettkampfprognose kannst du festlegen: automatisch, nur Garmins VO2max oder mit deinen Intervallen.",
    ],
  },
  {
    id: "2026-11-10",
    titel: "Großes Update",
    punkte: [
      "Einheiten: Jede Einheit hat jetzt eine eigene Seite mit Karte, Runden, Pulszonen und Verläufen über die Strecke (Pace, Puls, Höhe, Kadenz, Leistung).",
      "Diagramme im Vollbild: Kachel oder Diagramm antippen, dann siehst du es groß mit Erklärung.",
      "Neuer Reiter „Balance“: Stimmung eintragen und sehen, was dir guttut, dazu eine 1-Minuten-Atemübung.",
      "Morgen-Push: Jeden Morgen deine Erholungs-Ampel aufs iPhone (unter Konto → Benachrichtigungen einschalten).",
      "Strava verbinden: Kudos, Relative Effort und Einheiten, die nicht über Garmin laufen.",
      "Claude-Zugang: Frag Claude direkt nach deinen Daten, zum Beispiel wie deine Woche lief (unter Konto → Claude, nur lesend, Stimmung nur mit deiner Freigabe).",
      "Anmelden mit Face ID: Leg unter Konto → Anmeldung einen Passkey an, dann brauchst du kein Passwort mehr.",
      "Passwort lässt sich jetzt unter Konto → Anmeldung ändern.",
    ],
  },
];
