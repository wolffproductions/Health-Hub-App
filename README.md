# Health Hub

Dein persönliches Gesundheits- und Trainings-Dashboard fürs iPhone. Holt deine Daten aus **Garmin**, **Strava**
und **Withings**, je nachdem, was du nutzt. **Läuft in deinem eigenen, kostenlosen Cloudflare-Konto** – deine
Daten liegen nur dort, niemand sonst hat Zugriff.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wolffproductions/Health-Hub-App)

## Welche Daten kommen woher?

| Quelle | Was du bekommst |
|---|---|
| **Garmin** (Uhr) | Schlaf, HRV, Ruhepuls, Stress, Body Battery, Erholungs-Ampel, Trainings mit Runden, Pulszonen und Verläufen |
| **Strava** (jede Uhr oder App, die zu Strava lädt) | Trainings mit Karte, Kudos, Relative Effort, Bestzeiten |
| **Withings** (Waage) | Gewicht, Körperfett, Muskel- und Wasseranteil |

Du brauchst mindestens eine Quelle. Ohne Garmin gibt es keine Schlaf- und Erholungswerte, alles rund um
deine Trainings funktioniert aber auch nur mit Strava. Nutzt du Garmin und Strava, erkennt die App doppelte
Einheiten und zeigt sie nur einmal.

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
   - **Withings:** genauso, die Anleitung steht in der App.
6. Auf dem iPhone in Safari **Teilen → Zum Home-Bildschirm**. Jetzt ist es eine App, auch mit Morgen-Push.
   Unter **Konto → Anmeldung** kannst du dich danach per Face ID statt Passwort anmelden.

## Updates

Kommen **automatisch**: Einmal am Tag schaut deine Kopie auf GitHub nach einem neuen freigegebenen Stand und
Cloudflare spielt ihn von selbst ein. Du musst nichts tun. Deine Daten bleiben dabei erhalten.
Was neu ist, zeigt dir die App beim nächsten Öffnen. Die aktuelle Version steht ganz unten unter **Konto**.

Sofort aktualisieren: in deiner Kopie auf GitHub unter **Actions → Health Hub aktualisieren → Run workflow**.

## Datenschutz

- Die App läuft in **deinem** Cloudflare-Konto, die Daten liegen in **deiner** Datenbank.
- Garmin-Schlüssel, Strava- und Withings-Zugänge werden verschlüsselt gespeichert.
- Im Code auf GitHub stehen nie Daten oder Passwörter.
