#!/usr/bin/env bash
# Spielt eine neue Version ein. Daten, Garmin-Schlüssel und Passwort bleiben erhalten.
cd "$(dirname "$0")" || exit 1
git pull --ff-only 2>/dev/null || echo 'Kein git-Ordner oder lokale Änderungen – ich nehme den Stand, der gerade im Ordner liegt.'
[ -s .d1-id ] || { echo 'Noch nicht eingerichtet – bitte zuerst einrichten-mac.command ausführen.'; read -r -p "Enter"; exit 1; }
sed "s/HIER_D1_ID_EINTRAGEN/$(cat .d1-id)/" wrangler.jsonc > wrangler.local.jsonc
npm install --no-fund --no-audit && npx wrangler d1 migrations apply health-hub --remote -c wrangler.local.jsonc && npx wrangler deploy -c wrangler.local.jsonc
read -r -p "Enter zum Beenden"
