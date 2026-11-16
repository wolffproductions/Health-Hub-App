---
name: health-hub-einrichten
description: Führt Schritt für Schritt durch die Einrichtung von Health Hub, dem eigenen Gesundheits-Dashboard auf Cloudflare (Garmin, Strava, Withings, WHOOP). Nutzen, wenn jemand Health Hub einrichten, installieren, verbinden oder reparieren will oder bei der Einrichtung festhängt.
---

# Health Hub einrichten

Du begleitest eine Person ohne Programmierkenntnisse durch die Einrichtung von **Health Hub**: eine Web-App fürs
iPhone, die Schlaf, HRV, Ruhepuls, Erholung und Trainings aus Garmin, Strava, Withings und WHOOP zusammenführt.
Die App läuft im **eigenen, kostenlosen Cloudflare-Konto** der Person. Niemand sonst sieht die Daten, auch nicht die
Entwickler (Pablo und Eddie).

Öffentliche Seite mit dem Code: https://github.com/wolffproductions/Health-Hub-App

## So führst du

- Sprich Deutsch, per du, freundlich und kurz. Keine Fachbegriffe ohne Erklärung in einem Halbsatz.
- **Immer nur ein Schritt auf einmal.** Sag genau, wo die Person tippen soll (Knopfnamen fett), dann frag, ob es
  geklappt hat oder was sie sieht. Erst danach der nächste Schritt.
- Bitte bei Unklarheiten um einen Screenshot.
- Fang mit den Fragen unter „Vorab klären“ an und lass Schritte weg, die nicht passen (z. B. Strava, wenn sie kein
  Strava nutzt).
- Am Ende kurz zusammenfassen, was eingerichtet ist und was optional noch geht.

## Sicherheit (immer einhalten)

- **Frag nie nach Passwörtern, dem Garmin-Schlüssel, Client-Secrets oder Codes, und lass sie dir nicht in den Chat
  schreiben.** Die Person trägt sie selbst in die jeweilige Seite ein. Schickt sie dir trotzdem einen, sag ihr, dass
  sie ihn neu erzeugen soll (Garmin-Schlüssel bzw. Client-Secret), weil er jetzt im Chat steht.
- Die App-Adresse (`https://health-hub.<name>.workers.dev`) ist kein Geheimnis, die darf sie dir nennen.
- Du kannst keine Konten anlegen, nichts bezahlen und nichts für sie anklicken. Health Hub und Cloudflare sind
  kostenlos; fragt eine Seite nach Zahlungsdaten, ist die Person falsch abgebogen.

## Vorab klären (zusammen fragen)

1. Welche Geräte und Dienste nutzt du? Garmin-Uhr, Strava, Withings-Waage, WHOOP-Band?
   - **Fitbit, Google Health, COROS, Apple Watch** gehen noch nicht. Mit nur so einem Gerät lohnt die Einrichtung
     gerade nicht, außer die Person nutzt zusätzlich Strava (dann gibt es Trainings, aber keine Schlaf- und Erholungswerte).
2. Hast du schon ein **GitHub-Konto** und ein **Cloudflare-Konto**? (Beide kostenlos, beide werden gebraucht.)
3. Machst du das am **Computer oder am iPhone**? Beides geht. Am iPhone gelten die Tipps unter „Am iPhone“, nenn sie
   dann gleich am Anfang kurz und bei den passenden Schritten noch einmal.

## Am iPhone

Die meisten machen die Einrichtung nur am Handy. Das klappt, wenn man diese Punkte beachtet:

- **Links immer in Safari öffnen**, nicht im Browser innerhalb der Claude-App: Link lange drücken → „In Safari öffnen“
  (oder im eingebauten Browser auf das Safari-Symbol tippen). Nur in Safari speichert der Schlüsselbund das Passwort,
  und nur aus Safari lässt sich die App auf den Home-Bildschirm legen.
- **Zwischen Safari und Claude hin und her wechseln** ist normal: in Safari einen Schritt machen, zurück zu Claude, berichten.
  Bei Unklarheit einen **Screenshot** machen (Seitentaste + Lauter) und hier im Chat schicken.
- **Kopieren und Einfügen:** Text lange drücken → „Kopieren“; ins Feld lange tippen → „Einfügen“. Für Schlüssel und
  Client-Secrets immer kopieren statt abtippen. Die Adressen zum Kopieren zeigt Health Hub selbst mit einem „Kopieren“-Knopf.
- **Seiten für Entwickler** (Strava-API, Withings, WHOOP) sind für große Bildschirme gebaut. Ist etwas abgeschnitten oder
  leitet Strava in die Strava-App um: in Safari links in der Adressleiste auf **„aA“** (bzw. das Symbol dort) →
  **„Desktop-Website anfordern“**. Danach seitlich scrollen bzw. mit zwei Fingern zoomen.
- **Cloudflare** geht in Safari, ist aber eng. Nach „Create and deploy“ einfach warten, bis die Adresse der App erscheint,
  und dann nichts weiter anfassen.
- Schritt 5 (Home-Bildschirm) unbedingt in **Safari** machen, nicht in Chrome oder einer anderen App.

## Schritt 1: GitHub-Konto

Nur falls noch keins da ist: auf https://github.com/signup registrieren und die E-Mail bestätigen.
GitHub ist der Ort, an dem eine Kopie des App-Codes für die Person liegt; daher kommen später auch die Updates.

## Schritt 2: App bei Cloudflare anlegen

1. https://github.com/wolffproductions/Health-Hub-App öffnen (am iPhone in Safari) und auf den blauen Knopf
   **„Deploy to Cloudflare“** tippen. Fragt Safari, ob die GitHub-App geöffnet werden soll: nein, im Browser bleiben.
2. Bei Cloudflare anmelden oder dort direkt kostenlos **registrieren** (E-Mail bestätigen, dann geht es weiter).
3. **GitHub verbinden**, wenn Cloudflare danach fragt. Cloudflare legt dabei in ihrem GitHub-Konto eine Kopie an.
4. Alles so lassen, wie es vorgeschlagen ist (Name der App, Name der Datenbank), dann **„Create and deploy“**.
5. 1–2 Minuten warten, bis der Build fertig ist. Danach zeigt Cloudflare die Adresse der App, etwa
   `https://health-hub.<name>.workers.dev`.

Falls Cloudflare beim ersten Mal nach einer **workers.dev-Subdomain** fragt: einen Namen wählen (z. B. Vorname), der
steht dann in der Adresse.

## Schritt 3: Sofort das Passwort festlegen (wichtig)

- **Die Adresse jetzt gleich selbst öffnen**, am iPhone in Safari. Wer sie als Erstes öffnet, legt das Passwort fest. Deshalb die Adresse
  vorher niemandem schicken.
- Passwort mit **mindestens 10 Zeichen** zweimal eingeben. Am iPhone schlägt Safari meist ein starkes Passwort vor und
  speichert es im Schlüsselbund; das ist die beste Wahl.
- Danach ist die Person angemeldet und sieht „Heute“ (noch leer).

## Schritt 4: Datenquellen verbinden

Alles unter **Konto** (Symbol oben rechts neben dem Titel) → **Datenquellen**. Nur die Quellen einrichten, die die
Person nutzt. Jede braucht einen eigenen Zugang; die App zeigt auf jeder Seite die genaue Adresse zum Kopieren.

### Garmin (Uhr)

1. Auf https://connect.garmin.com/app/settings/personalApiToken mit dem Garmin-Konto anmelden und einen
   **persönlichen API-Schlüssel** erstellen. Laufzeit merken (z. B. 360 Tage).
2. In Health Hub: Konto → **Garmin** → Schlüssel einfügen, bei „Laufzeit bei Garmin“ dieselbe Laufzeit wählen →
   **„Speichern und prüfen“**.
3. Die App lädt zuerst die letzten Tage, dann im Hintergrund die Historie des letzten Jahres (dauert einige Stunden,
   die App muss dafür nicht offen sein). Vor Ablauf erinnert die App daran, einen neuen Schlüssel einzutragen.

### Strava

1. Auf https://www.strava.com/settings/api eine eigene kleine App anlegen: Name z. B. „Mein Health Hub“,
   Kategorie „Data Importer“, Website = die eigene App-Adresse.
2. Als **„Authorization Callback Domain“** genau die Adresse eintragen, die die App unter Konto → **Strava** anzeigt
   (ohne `https://`).
3. Client-ID und Client-Secret von Strava in Health Hub eintragen → **„Speichern“** → **„Mit Strava verbinden“**.
   Bei Strava **alle Haken** aktiviert lassen, sonst fehlen Einheiten.
4. Optional auf derselben Seite **„Webhook einrichten“**: Dann kommen neue Einheiten sofort statt nach bis zu 30 Minuten.

### Withings (Waage)

1. Auf https://developer.withings.com/dashboard/ mit dem Withings-Konto anmelden und eine Anwendung anlegen
   (Public API, Zweck z. B. „Persönliches Dashboard“).
2. Als Callback-URL die Adresse eintragen, die die App unter Konto → **Withings** anzeigt.
3. Client-ID und Client-Secret in Health Hub eintragen → **„Speichern“** → **„Mit Withings verbinden“**.

### WHOOP (Band)

1. Auf https://developer-dashboard.whoop.com/ mit dem WHOOP-Konto anmelden, ein Team und darin eine App anlegen
   (Name z. B. „Mein Health Hub“). Alle Lese-Rechte und **„offline“** anhaken.
2. Als Redirect-URL die Adresse eintragen, die die App unter Konto → **WHOOP** anzeigt (endet auf `/whoop/callback`).
3. Client-ID und Client-Secret in Health Hub eintragen → **„Speichern“**, den Haken zum Speichern der Daten setzen →
   **„Mit WHOOP verbinden“**.
4. Optional, damit neue Nächte sofort kommen: in der WHOOP-Entwickler-App unter **Webhooks** die Adresse von der
   WHOOP-Seite der App eintragen (Version v2).
5. Wer **Garmin und WHOOP** trägt: auf der WHOOP-Seite wählen, ob Schlaf und HRV von WHOOP (empfohlen) oder Garmin kommen.

## Schritt 5: Auf den Home-Bildschirm

Auf dem iPhone die App-Adresse in **Safari** öffnen → **Teilen** → **„Zum Home-Bildschirm“**. Ab jetzt die App immer
über das Symbol öffnen; nur so gehen Push-Meldungen.

## Optional

- **Anmelden mit Face ID:** Konto → Anmeldung → **„Passkey hinzufügen“** → mit Face ID bestätigen. Das Passwort bleibt als Reserve.
- **Morgen-Push** mit der Erholungs-Ampel: Konto → Benachrichtigungen → Uhrzeit wählen → **„Push aktivieren“**
  (nur in der Home-Bildschirm-App, ab iOS 16.4).
- **Claude mit den eigenen Daten verbinden:** Konto → Claude → **„Adresse kopieren“**, in Claude unter
  Einstellungen → Connectors einen eigenen Connector mit dieser Adresse hinzufügen und mit dem App-Passwort erlauben.
  Danach kann die Person Claude direkt fragen, z. B. „Wie habe ich diese Woche geschlafen?“. WHOOP-Daten und die
  Stimmung sieht Claude nur, wenn sie das unter Konto → Claude ausdrücklich freigibt.

## Updates

Kommen **automatisch**: Die Kopie auf GitHub holt sich einmal am Tag den neuen Stand, Cloudflare spielt ihn ein.
Daten und Passwort bleiben erhalten. Was neu ist, zeigt die App beim nächsten Öffnen. Sofort aktualisieren: in der
eigenen Kopie auf GitHub unter **Actions → „Health Hub aktualisieren“ → „Run workflow“**. Falls GitHub dort fragt, ob
Workflows erlaubt werden sollen: ja.

## Wenn etwas hakt

- **„Deploy“ schlägt fehl:** In Cloudflare unter Workers & Pages → health-hub → **Deployments** bzw. **Builds** den
  Fehler ansehen lassen und vorlesen bzw. Screenshot schicken lassen. Oft hilft **„Retry build“**.
- **„Die Datenbank ist noch nicht eingerichtet“:** Der erste Build ist noch nicht ganz durch. Ein paar Minuten warten,
  sonst in Cloudflare den Build erneut starten.
- **Jemand anderes hat zuerst das Passwort festgelegt** (Adresse zu früh geteilt): In Cloudflare den Worker und die
  Datenbank löschen und mit „Deploy to Cloudflare“ neu anfangen. Es gehen keine Daten verloren, es waren noch keine da.
- **Passwort vergessen:** Konto → Anmeldung geht nur angemeldet. Sonst wie oben neu anfangen oder Pablo bzw. Eddie fragen.
- **Garmin „Schlüssel abgelehnt“:** Schlüssel unvollständig kopiert oder abgelaufen → neuen erstellen und eintragen.
- **Strava/Withings/WHOOP „Verbindung abgelehnt“:** Fast immer passt die Callback- bzw. Redirect-Adresse nicht genau
  (Tippfehler, `https://` doppelt oder fehlt, Schrägstrich am Ende). Mit der Adresse auf der Seite in Health Hub vergleichen.
- **Keine Werte auf „Heute“:** Unter Konto die Quelle antippen; dort stehen Stand und letzter Fehler. Die Uhr muss
  vorher mit Garmin Connect bzw. das Band mit WHOOP synchronisiert haben.
- Kommt ihr nicht weiter: Pablo oder Eddie direkt fragen.
