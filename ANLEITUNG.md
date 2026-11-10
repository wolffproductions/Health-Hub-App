# Health Hub einrichten

Eine kleine Web-App, die deine eigenen Garmin-Daten über die offizielle Garmin Connect
Personal API abruft und als App fürs iPhone zeigt. Sie läuft kostenlos in **deinem eigenen**
Cloudflare-Konto. Nur du kommst mit deinem Passwort hinein, niemand sonst sieht deine Daten –
auch nicht die Leute, die die App gebaut haben.

**Bereiche:** Heute (Erholungs-Ampel), Training (Belastung akut/chronisch, Art der Einheiten,
Volumen, Pulszonen), Leistung (Pace je Zone, Laufökonomie, Bestzeiten, Radleistung, VO2max),
Schlaf (HRV mit Normalbereich, Schlafdauer, Wochentage) und Konto. Zeiträume von 4 Wochen bis
1 Jahr, jeweils im Vergleich zum Zeitraum davor. Aktualisiert sich alle 30 Minuten selbst.

**Nicht verfügbar**, weil Garmin es über die Personal API nicht anbietet: Training Readiness,
Training Status, VO2max (kannst du selbst eintragen). Die Erholungs-Ampel ist eine eigene,
offen erklärte Berechnung aus HRV, Ruhepuls, Schlaf und Belastung.

Du brauchst: einen Mac oder Windows-PC, eine Garmin-Uhr und etwa 30 Minuten.
Programmierkenntnisse brauchst du nicht.

---

## 1. Garmin-Schlüssel erstellen

1. Öffne https://connect.garmin.com/app/settings/personalApiToken und melde dich an.
2. Erstelle einen neuen Schlüssel. 90 Tage Laufzeit sind ein guter Mittelweg
   (Garmin erinnert dich per E-Mail, bevor er abläuft).
3. **Der Schlüssel wird nur einmal angezeigt.** Kopiere ihn z. B. in deinen Passwort-Manager.
   Schick ihn niemandem.

## 2. Kostenloses Cloudflare-Konto anlegen

1. https://dash.cloudflare.com/sign-up – mit E-Mail und Passwort registrieren, E-Mail bestätigen.
2. Fragt Cloudflare nach einer Website oder Domain: überspringen. Der kostenlose Plan reicht.

## 3. Node.js installieren

- **Mac:** https://nodejs.org → „LTS“ herunterladen und installieren.
- **Windows:** PowerShell öffnen, `winget install OpenJS.NodeJS.LTS` eingeben, danach den PC **neu starten**.

## 4. App einrichten

1. Den Ordner `health-hub` an einen festen Ort legen, z. B. „Dokumente“ (nicht in OneDrive/iCloud,
   dort stören die vielen Hilfsdateien).
2. **Mac:** Doppelklick auf `einrichten-mac.command`.
   Meldet macOS „kann nicht geöffnet werden“: Rechtsklick → „Öffnen“ → „Öffnen“.
   **Windows:** Im Ordner Rechtsklick → „Im Terminal öffnen“, dann
   `powershell -ExecutionPolicy Bypass -File .\einrichten-windows.ps1`
3. Das Skript führt dich durch sieben Schritte:
   - Ein Browserfenster von Cloudflare öffnet sich: auf **„Allow“** klicken.
   - Eventuell fragt Cloudflare nach einer **„workers.dev subdomain“**: ein Name aus Kleinbuchstaben
     und Bindestrichen, z. B. `max-training`. Nicht deinen vollen Namen, die Adresse ist öffentlich
     sichtbar (geschützt ist die App trotzdem durch dein Passwort).
   - Am Ende tippst du dein **App-Passwort** ein. Beim Tippen siehst du nichts, das ist normal.
     Nimm ein Passwort, das du sonst nirgends verwendest, mindestens 12 Zeichen.
4. Bei Schritt 5 steht deine Adresse, z. B. `https://health-hub.max-training.workers.dev`.

## 5. Garmin-Schlüssel in der App hinterlegen

1. Adresse öffnen (gern direkt auf dem iPhone), mit dem App-Passwort anmelden.
2. Unten auf **„Konto“** tippen, Garmin-Schlüssel einfügen, **„Speichern und prüfen“**.
3. Die App lädt jetzt dein letztes Jahr. Das dauert etwa eine Minute, den Fortschritt siehst du unter „Konto“.

## 6. Auf den Home-Bildschirm

- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“. Die App startet dann ohne Browserleiste.
- **Android (Chrome):** Menü → „Zum Startbildschirm hinzufügen“.

Du bleibst 30 Tage angemeldet.

**Anmelden mit Face ID (Passkey):** In der App oben rechts aufs **Konto-Symbol** → ganz unten bei
„Anmeldung“ **„Passkey hinzufügen“** → mit Face ID bestätigen. Ab dann steht auf der Anmeldeseite
**„Mit Passkey anmelden“**, ein Tippen genügt. Der Passkey liegt in deinem iCloud-Schlüsselbund und
funktioniert damit auch auf Mac und iPad. Dein Passwort bleibt als Reserve gültig.

## 7. Withings-Waage verbinden (freiwillig)

1. Auf [developer.withings.com](https://developer.withings.com/dashboard/) mit deinem Withings-Konto anmelden
   und eine Anwendung anlegen (Public API).
2. In der App oben rechts aufs **Konto-Symbol** → unter Datenquellen **Withings**. Dort steht die Callback-Adresse, die du bei
   Withings einträgst.
3. Client-ID und Client-Secret von Withings in der App eintragen, **„Speichern“**, dann **„Mit Withings verbinden“**.
4. Gewicht und Körperwerte erscheinen danach unter **Statistiken → Leistung**.

---

## Claude mit deinen Daten verbinden (freiwillig)

1. In der App oben rechts aufs **Konto-Symbol** → Abschnitt **Claude** → **„Adresse kopieren“**.
2. In Claude (Website oder iPhone-App) unter **Einstellungen → Connectors** einen eigenen Connector hinzufügen
   und die Adresse einfügen.
3. Es öffnet sich deine App: mit dem App-Passwort **„Erlauben“**.
4. Jetzt einfach fragen, z. B. „Wie habe ich diese Woche geschlafen?“. Claude kann nur lesen.
   Den Zugriff entziehst du jederzeit unter Konto → Claude.

## Gut zu wissen

- Deine Daten liegen nur in deinem eigenen Cloudflare-Konto und werden nie gelöscht.
- **Garmin-Schlüssel abgelaufen:** bei Garmin einen neuen erstellen und unter „Konto“ eintragen.
- **Passwort ändern:** im Ordner ein Terminal öffnen und
  `npx wrangler secret put APP_PASSWORD -c wrangler.local.jsonc` eingeben.
- **Neue Version einspielen:** `aktualisieren-mac.command` bzw. `aktualisieren-windows.ps1` starten.
  Daten, Schlüssel und Passwort bleiben erhalten.

## Probleme?

- **„npx wurde nicht erkannt“ / „command not found: npx“:** Node.js fehlt oder der Rechner wurde
  nach der Installation nicht neu gestartet.
- **Anmeldung bei Cloudflare „timed out“:** Skript erneut starten und im Browser zügig auf „Allow“ klicken.
- **„You need to register a workers.dev subdomain“:** Im Cloudflare-Dashboard links „Workers & Pages“,
  rechts unter „Account details“ bei „Subdomain“ einen Namen festlegen, Skript erneut starten.
- **Die App zeigt „Einrichtung unvollständig“:** Das Skript ist nicht bis zum Ende gelaufen. Einfach erneut starten.
- **Unter „Konto“ steht „Schlüssel abgelehnt“:** Garmin-Schlüssel abgelaufen oder unvollständig kopiert.
