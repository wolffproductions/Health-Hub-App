# Health Hub

Dein persönliches Gesundheits- und Trainings-Dashboard fürs iPhone: Garmin (Schlaf, HRV, Ruhepuls, Trainings),
optional Strava und Withings. **Läuft in deinem eigenen, kostenlosen Cloudflare-Konto** – deine Daten liegen nur
dort, niemand sonst hat Zugriff.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wolffproductions/Health-Hub-App)

## Einrichten (ca. 10 Minuten, ohne Terminal)

Du brauchst: ein kostenloses [GitHub-Konto](https://github.com/signup) und ein kostenloses
[Cloudflare-Konto](https://dash.cloudflare.com/sign-up).

1. Oben auf **„Deploy to Cloudflare“** tippen und bei Cloudflare anmelden.
2. GitHub verbinden (Cloudflare legt dort eine Kopie von Health Hub für dich an).
3. Alles so lassen, wie es vorgeschlagen ist, und **„Create and deploy“** wählen. Cloudflare legt die App
   und deine eigene Datenbank an. Das dauert 1–2 Minuten.
4. Die Adresse deiner App öffnen (z. B. `https://health-hub.<dein-name>.workers.dev`) und **sofort ein
   Passwort festlegen**. Wer die Adresse als Erstes öffnet, legt das Passwort fest – also direkt nach dem
   Einrichten selbst öffnen.
5. In der App unter **Konto → Garmin** deinen Garmin-Schlüssel eintragen
   ([hier erstellen](https://connect.garmin.com/app/settings/personalApiToken)).
6. Auf dem iPhone in Safari **Teilen → Zum Home-Bildschirm**. Jetzt ist es eine App, auch mit Morgen-Push.

## Updates

Kommen **automatisch**: Einmal am Tag schaut deine Kopie auf GitHub nach einem neuen freigegebenen Stand und
Cloudflare spielt ihn von selbst ein. Du musst nichts tun. Deine Daten bleiben dabei erhalten.
Die aktuelle Version steht in der App ganz unten unter **Konto**.

Sofort aktualisieren: in deiner Kopie auf GitHub unter **Actions → Health Hub aktualisieren → Run workflow**.

## Datenschutz

- Die App läuft in **deinem** Cloudflare-Konto, die Daten liegen in **deiner** Datenbank.
- Garmin-Schlüssel, Strava- und Withings-Zugänge werden verschlüsselt gespeichert.
- Im Code auf GitHub stehen nie Daten oder Passwörter.
