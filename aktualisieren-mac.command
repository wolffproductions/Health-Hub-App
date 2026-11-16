#!/usr/bin/env bash
# Spielt eine neue Version ein. Daten, Garmin-Schlüssel und Passwort bleiben erhalten.
cd "$(dirname "$0")" || exit 1
if [ -d .git ] && command -v git >/dev/null; then
  # npm install verändert package-lock.json; diese Änderung würde den Pull blockieren, also vorher zurücksetzen
  git checkout -- package-lock.json 2>/dev/null
  if ! git pull --ff-only; then
    echo
    echo 'Die neue Version konnte nicht geladen werden (git pull ist gescheitert). Abgebrochen, es wurde nichts eingespielt.'
    echo 'Häufige Gründe: keine Internetverbindung, oder im Ordner wurden Dateien geändert (dann: git status).'
    read -r -p "Enter zum Beenden"; exit 1
  fi
else
  echo 'Dieser Ordner ist kein git-Ordner, eine neue Version kann ich nicht laden.'
  read -r -p "Enter = den Stand einspielen, der gerade im Ordner liegt · Strg+C = abbrechen "
fi
[ -s .d1-id ] || { echo 'Noch nicht eingerichtet – bitte zuerst einrichten-mac.command ausführen.'; read -r -p "Enter"; exit 1; }
sed "s/HIER_D1_ID_EINTRAGEN/$(cat .d1-id)/" wrangler.jsonc > wrangler.local.jsonc
npm install --no-fund --no-audit && npx wrangler d1 migrations apply health-hub --remote -c wrangler.local.jsonc && npx wrangler deploy -c wrangler.local.jsonc
read -r -p "Enter zum Beenden"
