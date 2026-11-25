// „Was ist neu?“ (#91): Hinweis beim Öffnen der App nach einem Update. Neueste Einträge oben.
// Jede sichtbare Änderung bekommt hier eine kurze Zeile (Du-Form, aus Sicht der Nutzerin, ohne Technik).
// Neue Version = neuer Eintrag mit neuer `id` (Datum, bei mehreren am Tag mit Buchstabe: 2026-11-12b).
export interface NewsEntry { id: string; titel: string; punkte: string[] }

export const NEWS: NewsEntry[] = [
  {
    id: "2026-11-29b",
    titel: "Farben für deinen Bereich",
    punkte: [
      "Auf „Heute“ ist ein Wert jetzt grün, wenn er in deinem üblichen Bereich oder auf der guten Seite liegt. Gelb heißt etwas daneben, rot deutlich daneben, zum Beispiel ein Ruhepuls weit über deinem Normalwert.",
      "Unter Statistiken → Training folgt die Belastung oben jetzt der gewählten Woche bzw. dem Zeitraum. Bei 4 Wochen, 6 Monaten und 1 Jahr siehst du den Schnitt pro Woche.",
      "Intervalle im Trainingsplan werden fairer abgehakt: Ein- und Auslaufen zählen nicht mehr als Wiederholung, und wenn der Plan weniger Wiederholungen erlaubt, gibt es dafür volle Punkte.",
    ],
  },
  {
    id: "2026-11-29",
    titel: "Freunde: Zurückfolgen ohne Bestätigen",
    punkte: [
      "Folgst du jemandem zurück, der dir schon folgt, muss er das nicht mehr bestätigen. Ihr folgt euch dann sofort gegenseitig.",
      "„Zurückfolgen“ trifft jetzt immer die richtige Person, und Follower ohne Namen bekommen ihren Namen nachträglich.",
    ],
  },
  {
    id: "2026-11-28d",
    titel: "Bereitschaft von 0 bis 100",
    punkte: [
      "Auf „Heute“ steht neben der Erholung jetzt deine Bereitschaft als Zahl von 0 bis 100, ähnlich Garmins Trainingsbereitschaft. Grün ab 70, gelb ab 40.",
      "Klapp die Details auf, dann siehst du, was wie viel beiträgt: HRV, Schlaf, Erholung nach dem Training, Last, Ruhepuls und Body Battery. Auch der Morgen-Push nennt die Zahl.",
    ],
  },
  {
    id: "2026-11-28c",
    titel: "Strava-Segmente",
    punkte: [
      "Mit Strava siehst du auf der Seite einer Einheit jetzt die Segmente, die du gelaufen oder gefahren bist: deine Zeit, Tempo, Puls und ob es eine neue Bestzeit war.",
      "Einheiten, die nur über Strava kommen (ohne Garmin), zeigen jetzt auch Runden bzw. Kilometer-Splits und Stravas Bestleistungen.",
      "Ältere Einheiten der letzten 6 Monate holt die App nach und nach nach.",
    ],
  },
  {
    id: "2026-11-28b",
    titel: "Mehr zum Antippen, Belastung verständlicher",
    punkte: [
      "Auf „Heute“ kannst du jetzt jeden Punkt der Erholung antippen: HRV, Ruhepuls oder Schlaf öffnen ihr Diagramm über die letzten 7 Tage, „Last“ die Belastung, „Erholung“ die Einheit, nach der du dich gerade erholst.",
      "Unter Statistiken → Training zeigt die Belastung ihre Werte jetzt wie „Heute“: Wert, Verlauf über 8 Wochen und dein üblicher Bereich. Statt „Akut zu chronisch“ heißt es einfach „Last“.",
    ],
  },
  {
    id: "2026-11-28",
    titel: "VO2max wieder automatisch",
    punkte: ["Die App liest deine VO2max jetzt direkt aus der Datei jedes Laufs, so wie die Uhr sie berechnet. Du musst sie nicht mehr selbst eintragen. Ältere Läufe holt sie nach und nach im Hintergrund nach.",
      "Weil Garmins Wert nach lockeren Läufen gern mal einen Punkt springt, zeigt die App jetzt den Schnitt deiner letzten Werte als Linie, die Einzelwerte als Punkte. Auch Einschätzung und Wettkampfprognose rechnen mit dem Schnitt."],
  },
  {
    id: "2026-11-27",
    titel: "Feedback direkt aus der App",
    punkte: ["Unter Konto → Feedback geben schickst du Fehler, Wünsche oder Lob direkt an Pablo und Eddie, auf Wunsch mit Screenshot. Was mitgeschickt wird, siehst und wählst du selbst."],
  },
  {
    id: "2026-11-26d",
    titel: "Freundesprofil aufgeräumt",
    punkte: ["Oben im Profil eines Freundes stehen jetzt wie bei Instagram oder Strava seine Einheiten in diesem Jahr, Follower und Gefolgt. „Aktivitäten“ steht immer da und sagt dir auch, wenn er sie noch nicht teilt."],
  },
  {
    id: "2026-11-26c",
    titel: "Start auf „Heute“",
    punkte: ["Die App öffnet sich jetzt immer auf „Heute“. Auch wenn sie länger als eine Viertelstunde im Hintergrund lag, geht es dort wieder los."],
  },
  {
    id: "2026-11-26b",
    titel: "Freundesprofil wie bei Strava",
    punkte: [
      "Das Profil eines Freundes zeigt oben Bild und die wichtigsten Zahlen, darunter Aktivitäten, Statistiken, Bestzeiten und Leistung zum Aufklappen.",
      "Tipp auf sein Profilbild, dann siehst du es groß. Mit zwei Fingern ziehst du den ganzen Kreis größer, beim Loslassen gleitet er zurück. Follower, denen du auch folgst, haben jetzt ihr Profilbild in der Liste.",
    ],
  },
  {
    id: "2026-11-26",
    titel: "Profilbild zoomen und Wochenüberblick",
    punkte: [
      "Dein Profilbild kannst du in der großen Ansicht jetzt mit zwei Fingern größer ziehen, beim Loslassen gleitet es zurück.",
      "Unter Einheiten gibt es im Überblick jetzt auch „Woche“: alles seit Montag, nach Sportart mit Einheiten, Kilometern und Zeit.",
    ],
  },
  {
    id: "2026-11-25e",
    titel: "Profile deiner Freunde",
    punkte: [
      "Tipp in der Rangliste oder unter Konto → Freunde auf einen Freund, dann öffnet sich sein Profil: Umfang, Bestzeiten, Leistung und VO2max.",
      "Neu zum Teilen: deine letzten 10 Aktivitäten mit Karte. Die ersten und letzten 200 m jeder Route werden dabei weggelassen. Einschalten unter Konto → Freunde.",
    ],
  },
  {
    id: "2026-11-25d",
    titel: "Freundesliste aufgeräumt",
    punkte: ["Unter Konto → Freunde haben Profilbilder und Knöpfe in den Listen jetzt Abstand zum Rand, wie überall sonst."],
  },
  {
    id: "2026-11-25c",
    titel: "Woche = letzte 7 Tage",
    punkte: ["„1 W“ unter Statistiken zeigt jetzt immer die letzten 7 Tage bis heute statt der Kalenderwoche, verglichen mit den 7 Tagen davor. So siehst du auch am Dienstag eine ganze Woche. Mit den Pfeilen blätterst du in 7-Tage-Schritten zurück."],
  },
  {
    id: "2026-11-25b",
    titel: "Diagramme ohne Kopier-Menü",
    punkte: ["Hältst du den Finger länger auf ein Diagramm oder die Karte, markiert das iPhone keine Zahlen mehr und öffnet kein Kopieren-Menü. Du siehst einfach die Werte an der Stelle."],
  },
  {
    id: "2026-11-25",
    titel: "Rad-Wetter: Wann kann ich fahren?",
    punkte: [
      "Unter Einheiten findest du jetzt Rad-Wetter. Die App sucht in der Vorhersage der nächsten 48 Stunden gute Fenster zum Radfahren nach deinen eigenen Kriterien, trocken auch auf der Straße, wenig Wind, angenehm warm, und zählt bis zum Start herunter.",
      "Eine kleine Figur auf dem Rad zeigt, was du anziehen solltest, von kurz-kurz bis Regenjacke und Überschuhe, mit Fahrtwind gerechnet. Tipp ein Teil an, und du siehst die Regel dazu. Die Regeln stellst du selbst ein, und nach jeder Fahrt lernt die App aus deinem „zu kalt“ oder „zu warm“.",
      "Wind von vorn? Die App sagt, in welche Richtung du zuerst fährst und welche Lieblingsrunde heute am besten passt.",
      "Dazu Wochenziel, Serie und Abzeichen wie Frühaufsteher, Regenradler oder Kälteprofi, nur für dich. Auf Wunsch meldet sich die App, wenn sich ein gutes Fenster auftut: Konto → Benachrichtigungen.",
    ],
  },
  {
    id: "2026-11-24",
    titel: "Trainingsplan mit Claude",
    punkte: [
      "Deinen Trainingsplan erstellst du jetzt zusammen mit Claude. Erlaube es unter Konto → Claude („Claude darf meinen Trainingsplan schreiben“) und sag Claude, worauf du hintrainierst.",
      "Auf „Heute“ siehst du direkt unter der Erholung, was heute ansteht, und eine Notiz von Claude. Der Morgen-Push nennt die Einheit mit.",
      "Unter Einheiten findest du den Plan Woche für Woche. Gelaufene Einheiten werden abgehakt, mit Prozent, wie gut du sie getroffen hast. Antippen zum Verschieben oder selbst Abhaken.",
    ],
  },
  {
    id: "2026-11-23c",
    titel: "Teilen: Schriftgröße und Wetter",
    punkte: ["Beim Teilen als Grafik stellst du jetzt die Schriftgröße der Kennzahlen ein und blendest das Wetter ein oder aus. Die Zahlen ordnen sich selbst so an, dass nichts zu eng wird, im Format 4:5 zum Beispiel zwei mal zwei."],
  },
  {
    id: "2026-11-23b",
    titel: "Mitteilungen nach deinem Geschmack",
    punkte: [
      "Unter Konto → Benachrichtigungen wählst du jetzt einzeln, welche Mitteilungen du bekommst: Morgenbericht, Freunde und neue Funktionen.",
      "Neu: Auf Wunsch meldet sich die App kurz, wenn sie etwas Neues kann, nur tagsüber. Wetter für deine Ausfahrten kommt später dazu.",
    ],
  },
  {
    id: "2026-11-23",
    titel: "Trainingsplan pausiert",
    punkte: ["Den Trainingsplan unter Einheiten haben wir vorerst herausgenommen. Bald erstellst du deinen Plan zusammen mit Claude, und die App zeigt dir dann jeden Tag, was ansteht."],
  },
  {
    id: "2026-11-22d",
    titel: "Werte beim Streichen über das Profil",
    punkte: [
      "Ziehst du in der großen Karte mit dem Finger über das Profil unter der Karte, laufen unten Distanz, Zeit, Pace, Puls, Höhe, Kadenz und Leistung an dieser Stelle mit, wie beim Abspielen. Lässt du los, bleiben die Werte stehen, bis du auf die Karte tippst.",
    ],
  },
  {
    id: "2026-11-22c",
    titel: "Teile deine Route als Grafik, sieh sie in 3D",
    punkte: [
      "Auf der Seite einer Einheit und in der Vollbild-Karte gibt es jetzt „Teilen“: Mach aus deiner Route eine Grafik, nur die Linie auf transparentem Hintergrund zum Drüberlegen auf eigene Fotos und Videos, mit Kennzahlen, mit Höhenprofil oder auf der Karte. Formate für Story, Feed, quadratisch und quer, Farbe und Linie wählst du selbst. Teilen, in die Zwischenablage kopieren oder als PNG sichern.",
      "Start und Ziel werden auf Wunsch gekürzt, damit deine Haustür nicht auf dem Bild landet. Das ist von Anfang an eingeschaltet.",
      "In der Vollbild-Karte schaltet „3D“ das Gelände echt dreidimensional, „Rundflug“ dreht langsam um deine Route. Die aktuelle Ansicht kannst du direkt als Grafik teilen.",
    ],
  },
  {
    id: "2026-11-22b",
    titel: "Klarer oben, Erholung in Farbe",
    punkte: [
      "Oben am Bildschirmrand liegt kein unscharfer Streifen mehr, auch nicht beim Scrollen über der Leiste.",
      "Der Satz zur Erholung auf „Heute“ steht jetzt in der Farbe der Ampel: grün, gelb oder rot.",
    ],
  },
  {
    id: "2026-11-22",
    titel: "Trainingsplan hakt ab",
    punkte: [
      "Gelaufene Einheiten werden im Trainingsplan automatisch abgehakt, auch wenn du sie einen Tag getauscht hast. Dahinter steht, wie gut du sie getroffen hast, zum Beispiel 92 %, und darunter warum.",
      "Bei lockeren Läufen zählen Strecke und Puls in Zone 2, bei Intervallen die Wiederholungen und das Tempo. Ohne Uhr gelaufen? Tipp die Einheit an und hak sie selbst ab.",
      "Oben in jeder Woche siehst du, wie viel du schon erledigt hast.",
    ],
  },
  {
    id: "2026-11-19c",
    titel: "Fitbit und Pixel Watch",
    punkte: [
      "Unter Konto → Datenquellen kannst du jetzt Google Health verbinden. Dann kommen Schlaf, HRV, Ruhepuls, Sauerstoff, Schritte und Trainings von deiner Fitbit, Pixel Watch oder Fitbit Air.",
      "Trägst du zusätzlich eine Garmin-Uhr, zeigt die App gleiche Trainings nur einmal, und du wählst, von welchem Gerät die Nachtwerte kommen.",
    ],
  },
  {
    id: "2026-11-21b",
    titel: "Trainingsplan: Puls, fester Intervalltag, verschieben und Pausen",
    punkte: [
      "Lockere Läufe richten sich jetzt nach deinem Puls: Die App schaut, welche Pace du bei Zone 2 läufst, und passt das mit deiner Form laufend an. Jede Einheit zeigt dazu die Pulszone.",
      "Du kannst einen festen Tag für Intervalle wählen, zum Beispiel dein Vereinstraining am Dienstag, und den Start-Umfang selbst angeben.",
      "Tipp eine Einheit an, um sie auf einen anderen Tag der Woche zu legen. Ist der Tag belegt, tauschen die beiden.",
      "Krank oder im Urlaub? Trag eine Pause ein. Der Plan ruht und steigt danach langsamer wieder ein.",
    ],
  },
  {
    id: "2026-11-21",
    titel: "Die Karte kann jetzt mehr",
    punkte: [
      "Im Vollbild gibt es oben rechts einen Kompass: Mit zwei Fingern drehst und neigst du die Karte, ein Tippen auf den Kompass richtet sie wieder nach Norden aus.",
      "Über das Ebenen-Symbol wählst du Standard, Satellit oder Topo, blendest Schummerung, Kilometer, Richtung, Runden und Pausen ein und färbst die Route nach Tempo, Puls, Höhe oder Steigung. Dein Gerät merkt sich die Wahl.",
      "Tippst du auf die Route, siehst du die Werte an dieser Stelle. Unter der Karte zeigt ein Profil den Verlauf, ziehst du darauf, wandert der Punkt auf der Karte mit. Das klappt auch mit den Diagrammen auf der Seite der Einheit.",
      "Auf Wunsch zeigt die Karte deinen Standort und wie weit du von der Strecke entfernt bist, praktisch zum Nachlaufen.",
    ],
  },
  {
    id: "2026-11-20b",
    titel: "Marathon-Prognose richtet sich nach deinem Umfang",
    punkte: [
      "Für den Marathon zählt jetzt vor allem dein Wochenumfang: Erst ab etwa 80 km pro Woche und langen Läufen über 30 km rechnet die Prognose mit deiner vollen Form.",
      "Im Trainingsplan stimmt „Heute möglich“ beim Halbmarathon jetzt mit der Prognose überein.",
    ],
  },
  {
    id: "2026-11-20",
    titel: "Ehrlichere Prognose für lange Strecken",
    punkte: [
      "Die Prognose für Halbmarathon und Marathon schaut jetzt genauer auf deinen Wochenumfang und deinen längsten Lauf. Mit wenig Umfang fällt sie vorsichtiger aus.",
      "Der Trainingsplan rechnet dafür mit ein, dass du diese Ausdauer bis zum Wettkampf aufbaust. „Heute möglich“ ist ehrlicher, „Mit dem Plan realistisch“ bleibt fair.",
    ],
  },
  {
    id: "2026-11-19b",
    titel: "Trainingsplan: mehr Umfang für Schnelle",
    punkte: ["Der Wochenumfang im Trainingsplan richtet sich jetzt auch nach deiner Form: Je schneller du bist, desto mehr Kilometer plant er ein. Unter „Höchster Wochenumfang“ kannst du auch selbst ein Ziel angeben, zum Beispiel 70 km."],
  },
  {
    id: "2026-11-19",
    titel: "Dein Trainingsplan",
    punkte: [
      "Unter Einheiten → Trainingsplan wählst du dein Ziel: 5 km, 10 km, Halbmarathon, Marathon oder einfach fit bleiben, dazu Wettkampftag, Wunschzeit und Lauftage pro Woche.",
      "Die App sagt dir ehrlich, ob deine Wunschzeit realistisch, ambitioniert oder sehr ambitioniert ist, und erstellt einen Plan mit konkreten Einheiten, Tempo und Kilometern, Woche für Woche bis zum Wettkampf.",
    ],
  },
  {
    id: "2026-11-18h",
    titel: "Folge-Anfragen",
    punkte: [
      "Freunde sind jetzt wie ein privates Konto: Wer deinen Link einträgt, schickt dir eine Anfrage. Erst wenn du sie unter Konto → Freunde und Freigaben annimmst, sieht er deine freigegebenen Werte.",
      "Ist dein Morgen-Push eingeschaltet, bekommst du neue Anfragen auch als Mitteilung. Entfernst du einen Follower, sieht nur er nichts mehr.",
      "Folgen klappt jetzt auch wirklich: Ein Fehler beim Abruf ist behoben. Mit „Einfügen“ setzt du einen kopierten Link mit einem Tipp ein.",
    ],
  },
  {
    id: "2026-11-18g",
    titel: "Ruhigerer Hintergrund",
    punkte: ["Das Karo-Raster steht nur noch oben beim Titel und läuft nach unten aus. Hinter deinen Werten und Diagrammen ist der Hintergrund jetzt ruhig."],
  },
  {
    id: "2026-11-18f",
    titel: "Wetter bei deinen Einheiten",
    punkte: [
      "Unter Konto → Datenquellen kannst du „Wetter“ einschalten. Dann siehst du bei jeder Einheit mit GPS Temperatur, Wind und Wetterlage.",
      "Unter Statistiken → Leistung zeigt „Wetter und Tempo“, wie Hitze, Kälte, Wind und Regen dein Lauftempo beeinflussen.",
    ],
  },
  {
    id: "2026-11-18e",
    titel: "Freunde und Rangliste",
    punkte: [
      "Unter Statistiken gibt es jetzt „Freunde“: eine Rangliste mit deinen Freunden, getrennt nach Laufen und Rad. Kilometer, Zeit, Höhenmeter und Einheiten pro Woche, Monat oder Jahr, dazu Bestzeiten, beim Rad deine Leistung (in Watt pro Kilo, damit leichte und schwere Fahrer fair verglichen werden, oder in Watt) und beim Laufen die VO2max.",
      "Unter Konto → Freunde und Freigaben findest du deinen Freundeslink und QR-Code. Schick ihn an Freunde mit eigener Health-Hub-App, und trag dort ihren Link ein, um ihnen zu folgen.",
      "Du legst selbst fest, was andere sehen. Standardmäßig ist alles aus, Stimmung, Schlaf und Gesundheitswerte werden nie geteilt. Oben im Konto siehst du, wie viele dir folgen und wem du folgst.",
    ],
  },
  {
    id: "2026-11-18d",
    titel: "Profilbild zuschneiden",
    punkte: [
      "Wenn du ein Profilbild auswählst, siehst du jetzt einen runden Rahmen: Verschiebe das Foto mit einem Finger und zoome mit zwei, dann „Übernehmen“.",
      "Tippe im Konto auf dein Bild, um es groß anzusehen. Oben rechts hat dein Bild jetzt einen feinen Rand.",
    ],
  },
  {
    id: "2026-11-18c",
    titel: "Neues Konto mit Profil",
    punkte: [
      "Das Konto ist jetzt aufgeräumt wie die iPhone-Einstellungen: Datenquellen, Benachrichtigungen, Claude, Pulszonen, Prognose und Anmeldung haben je eine eigene Seite.",
      "Oben im Konto legst du deinen Namen und ein Profilbild fest. Dein Bild erscheint dann auch oben rechts neben dem Titel.",
    ],
  },
  {
    id: "2026-11-18b",
    titel: "Bestleistungen",
    punkte: [
      "Unter Statistiken → Leistung findest du jetzt deine Bestleistungen, wie bei Strava: beim Laufen von 400 m bis Marathon, beim Rad von 5 bis 160 km.",
      "Beim Rad kannst du auf „Leistung“ umschalten und siehst deine besten Watt über 5 Sekunden bis 2 Stunden. Antippen öffnet die Einheit, in der du sie geschafft hast.",
      "Die Werte kommen aus den Dateien deiner Uhr. Ältere Einheiten werden in den nächsten Tagen nach und nach ausgewertet, es kommen also noch Werte dazu.",
    ],
  },
  {
    id: "2026-11-18",
    titel: "Morgenbericht nach dem Aufwachen",
    punkte: [
      "Unter Konto → Benachrichtigungen kannst du „Nach dem Aufwachen“ wählen: Der Morgenbericht kommt dann automatisch, sobald dein Schlaf der letzten Nacht da ist, statt zu einer festen Uhrzeit.",
      "Mit Garmin kommt er kurz nachdem deine Uhr mit dem Handy synchronisiert hat, mit WHOOP direkt nach dem Aufwachen. Ist bis zur eingestellten Uhrzeit nichts da, kommt er mit dem letzten Stand.",
    ],
  },
  {
    id: "2026-11-17f",
    titel: "Route abspielen",
    punkte: [
      "Öffne die Karte einer Einheit im Vollbild und tippe auf „Abspielen“: Deine Route zeichnet sich vom Start bis zum Ziel nach, die Karte fährt geneigt mit.",
      "Unten laufen deine Werte an genau dieser Stelle mit: Distanz, Zeit, Pace, Puls, Höhe und Kadenz (beim Rad Tempo und Leistung).",
      "„Stopp“ hält genau dort an. Mit „Weiter“ geht es von da aus weiter, mit „Von vorn“ neu los. Start und Ziel sind auf der Karte markiert.",
    ],
  },
  {
    id: "2026-11-17d",
    titel: "Neuer Look, Teil 3",
    punkte: [
      "Statistiken, Einheiten und Balance lesen sich jetzt wie „Heute“: Abschnitte beginnen mit einer dicken Linie, Diagramme stehen ohne Kasten auf der Seite.",
      "Kennzahlen stehen in zwei Spalten, durch feine Linien getrennt. Antippen und Vollbild funktionieren wie bisher.",
    ],
  },
  {
    id: "2026-11-17c",
    titel: "Neuer Look, Teil 2",
    punkte: [
      "Die Karte passt sich an: im hellen Modus hell wie eine Blaupause, im dunklen fast schwarz, die Route immer in Blau.",
      "Auf der Karte siehst du jetzt, wo du gestartet bist (blauer Punkt) und wo du angekommen bist (Zielflagge).",
      "Die Art einer Einheit (Grundlage, Schwelle, VO2max …) steht jetzt als ruhige Marke da. In den Diagrammen gehen die Farben von hellem Graublau für lockere bis Violett für harte Einheiten.",
      "Balken, Punkte und Legenden sind kantiger, passend zum neuen Look.",
    ],
  },
  {
    id: "2026-11-17b",
    titel: "Neuer Look, Teil 1",
    punkte: [
      "Die App hat einen eigenen Look: dunkel mit feinem Raster, hell wie eine Blaupause. Blau zeigt deine Daten, Grün, Gelb und Rot gibt es nur noch für Bewertungen.",
      "„Heute“ liest sich wie eine Morgenausgabe: oben die Erholung als Schlagzeile, darunter deine Werte als Zeilen mit dem Verlauf der letzten 14 Tage.",
      "Neu ist „Dein Bereich“: Ein kleiner Balken zeigt, ob ein Wert unter, in oder über deinem üblichen Bereich liegt. Antippen öffnet wie bisher das Diagramm.",
    ],
  },
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
