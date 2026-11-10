// „Was ist neu?“ (#91): Hinweis beim Öffnen der App nach einem Update. Neueste Einträge oben.
// Jede sichtbare Änderung bekommt hier eine kurze Zeile (Du-Form, aus Sicht der Nutzerin, ohne Technik).
// Neue Version = neuer Eintrag mit neuer `id` (Datum, bei mehreren am Tag mit Buchstabe: 2026-11-12b).
export interface NewsEntry { id: string; titel: string; punkte: string[] }

export const NEWS: NewsEntry[] = [
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
