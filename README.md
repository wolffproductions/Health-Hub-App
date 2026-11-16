# Health Hub

Dein persönliches Gesundheits- und Trainings-Dashboard fürs iPhone. Holt deine Daten aus **Garmin**, **Strava**,
**Withings** und **WHOOP**, je nachdem, was du nutzt. **Läuft in deinem eigenen, kostenlosen Cloudflare-Konto** – deine
Daten liegen nur dort, niemand sonst hat Zugriff.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wolffproductions/Health-Hub-App)

## Welche Daten kommen woher?

| Quelle | Was du bekommst |
|---|---|
| **Garmin** (Uhr) | Schlaf, HRV, Ruhepuls, Stress, Body Battery, Erholungs-Ampel, Trainings mit Runden, Pulszonen und Verläufen |
| **Strava** (jede Uhr oder App, die zu Strava lädt) | Trainings mit Karte, Kudos, Relative Effort, Bestzeiten |
| **Withings** (Waage) | Gewicht, Körperfett, Muskel- und Wasseranteil |
| **WHOOP** (Band) | Recovery, Schlaf, HRV, Ruhepuls, Strain, Erholungs-Ampel, Trainings (ohne Karte und Runden) |

Du brauchst mindestens eine Quelle. Schlaf- und Erholungswerte kommen von Garmin oder WHOOP, alles rund um
deine Trainings funktioniert aber auch nur mit Strava. Nutzt du mehrere Quellen, erkennt die App doppelte
Einheiten und zeigt sie nur einmal. Bei Garmin-Uhr und WHOOP-Band wählst du, woher Schlaf und HRV kommen.

## Mit Claude einrichten (empfohlen)

Lass dich von [Claude](https://claude.ai) Schritt für Schritt durch die Einrichtung führen. Claude sagt dir bei
jedem Schritt, wo du tippen musst, und hilft, wenn etwas hakt. Passwörter und Schlüssel trägst du dabei immer selbst
in der App ein, nie im Chat.

**Variante A, als Skill (einmal hochladen):**

1. [**health-hub-einrichten.zip**](https://github.com/wolffproductions/Health-Hub-App/raw/main/health-hub-einrichten.zip) herunterladen (nicht entpacken).
2. In Claude unter **Einstellungen → Funktionen** prüfen, dass **„Code-Ausführung und Dateierstellung“**
   (bzw. **„Dateien erstellen und bearbeiten“**) an ist.
3. **Anpassen → Skills → „+“ → „Skill erstellen“ → „Skill hochladen“** und die ZIP-Datei auswählen.
4. Einen neuen Chat öffnen und schreiben: **„Hilf mir, Health Hub einzurichten.“**

**Variante B, ohne Hochladen:** In einem neuen Chat mit Claude schreiben:

> Hilf mir Schritt für Schritt, Health Hub einzurichten. Lies dazu diese Anleitung und halte dich daran:
> https://github.com/wolffproductions/Health-Hub-App/blob/main/claude-skill/health-hub-einrichten/SKILL.md

## Einrichten (ca. 10 Minuten, ohne Terminal)

Du brauchst ein kostenloses [GitHub-Konto](https://github.com/signup). Ein Cloudflare-Konto legst du
unterwegs an, falls du noch keins hast.

1. Oben auf **„Deploy to Cloudflare“** tippen. Bei Cloudflare anmelden oder, falls du noch kein Konto hast,
   dort direkt kostenlos **registrieren** (E-Mail bestätigen, dann geht es weiter).
2. GitHub verbinden (Cloudflare legt dort eine Kopie von Health Hub für dich an).
3. Alles so lassen, wie es vorgeschlagen ist, und **„Create and deploy“** wählen. Cloudflare legt die App
   und deine eigene Datenbank an. Das dauert 1–2 Minuten.
4. Die Adresse deiner App öffnen (z. B. `https://health-hub.<dein-name>.workers.dev`) und **sofort ein
   Passwort festlegen**. Wer die Adresse als Erstes öffnet, legt das Passwort fest – also direkt nach dem
   Einrichten selbst öffnen.
5. Deine Datenquellen verbinden, oben rechts aufs **Konto-Symbol** → **Datenquellen**:
   - **Garmin:** Schlüssel [hier erstellen](https://connect.garmin.com/app/settings/personalApiToken) und eintragen.
   - **Strava:** In der App steht Schritt für Schritt, wie du bei Strava eine eigene kleine App anlegst
     (dauert 2 Minuten), danach **„Mit Strava verbinden“**.
   - **Withings** und **WHOOP:** genauso, die Anleitung steht in der App.
6. Auf dem iPhone in Safari **Teilen → Zum Home-Bildschirm**. Jetzt ist es eine App, auch mit Morgen-Push.
   Unter **Konto → Anmeldung** kannst du dich danach per Face ID statt Passwort anmelden.

## Updates

Kommen **automatisch**: Einmal am Tag schaut deine Kopie auf GitHub nach einem neuen freigegebenen Stand und
Cloudflare spielt ihn von selbst ein. Du musst nichts tun. Deine Daten bleiben dabei erhalten.
Was neu ist, zeigt dir die App beim nächsten Öffnen. Die aktuelle Version steht ganz unten unter **Konto**.

Sofort aktualisieren: in deiner Kopie auf GitHub unter **Actions → Health Hub aktualisieren → Run workflow**.

## Datenschutz

- Die App läuft in **deinem** Cloudflare-Konto, die Daten liegen in **deiner** Datenbank.
- Garmin-Schlüssel, Strava-, Withings- und WHOOP-Zugänge werden verschlüsselt gespeichert.
- Im Code auf GitHub stehen nie Daten oder Passwörter.
