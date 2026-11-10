#!/usr/bin/env bash
# Richtet Health Hub im eigenen Cloudflare-Konto ein (macOS/Linux).
# Doppelklick im Finder oder im Terminal:  ./einrichten-mac.command
# Kann gefahrlos mehrmals ausgeführt werden.
cd "$(dirname "$0")" || exit 1

step() { printf '\n\033[36m[%s/7] %s\033[0m\n' "$1" "$2"; }
hint() { printf '\033[33m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; read -r -p "Enter zum Beenden"; exit 1; }

command -v npx >/dev/null 2>&1 || fail 'Node.js fehlt. Installiere die LTS-Version von https://nodejs.org und starte das Skript erneut.'

step 1 'Werkzeuge installieren (dauert etwa eine Minute) ...'
npm install --no-fund --no-audit || fail 'Installation fehlgeschlagen. Besteht eine Internetverbindung?'

step 2 'Bei Cloudflare anmelden ...'
if npx wrangler whoami 2>&1 | grep -qi 'not authenticated'; then
  hint 'Gleich öffnet sich ein Browserfenster von Cloudflare. Klicke dort auf "Allow".'
  npx wrangler login || fail 'Anmeldung fehlgeschlagen. Skript erneut starten und im Browser zügig auf "Allow" klicken.'
else
  echo 'Bereits angemeldet.'
fi

step 3 'Datenbank anlegen ...'
# Die Datenbank-ID ist pro Person verschieden. Sie liegt in .d1-id (nicht in git), daraus entsteht
# wrangler.local.jsonc. So bleibt wrangler.jsonc im Repo für alle gleich und "git pull" klappt immer.
if [ ! -s .d1-id ]; then
  out=$(npx wrangler d1 create health-hub 2>&1)
  id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$id" ]; then
    # Existiert schon (z. B. nach abgebrochenem Lauf): ID aus der Liste holen
    id=$(npx wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const x=JSON.parse(s).find(d=>d.name==="health-hub");process.stdout.write(x?x.uuid:"")}catch{}})')
  fi
  [ -n "$id" ] || { echo "$out"; fail 'Die Datenbank konnte nicht angelegt werden.'; }
  printf '%s' "$id" > .d1-id
  echo 'Datenbank angelegt.'
else
  echo 'Datenbank ist schon vorhanden.'
fi
sed "s/HIER_D1_ID_EINTRAGEN/$(cat .d1-id)/" wrangler.jsonc > wrangler.local.jsonc
W="-c wrangler.local.jsonc"

step 4 'Datenbank-Tabellen anlegen ...'
npx wrangler d1 migrations apply health-hub --remote $W || fail 'Tabellen konnten nicht angelegt werden.'

step 5 'App hochladen ...'
hint 'Falls Cloudflare nach einer "workers.dev subdomain" fragt: Namen aus Kleinbuchstaben und Bindestrichen eingeben, z. B. "max-training" (nicht den vollen Namen).'
npx wrangler deploy $W || fail 'Hochladen fehlgeschlagen. Siehe "Probleme" in ANLEITUNG.md.'

step 6 'Sitzungs-Geheimnis erzeugen ...'
if npx wrangler secret list $W 2>/dev/null | grep -q '"SESSION_SECRET"'; then
  echo 'Schon vorhanden, bleibt unverändert (sonst müsstest du den Garmin-Schlüssel neu eintragen).'
else
  openssl rand -base64 48 | tr -d '\n' | npx wrangler secret put SESSION_SECRET $W || fail 'Sitzungs-Geheimnis konnte nicht gesetzt werden.'
fi

step 7 'App-Passwort festlegen ...'
if npx wrangler secret list $W 2>/dev/null | grep -q '"APP_PASSWORD"'; then
  echo 'Schon vorhanden. Ändern geht jederzeit mit:  npx wrangler secret put APP_PASSWORD -c wrangler.local.jsonc'
else
  hint 'Tippe gleich dein Passwort für die App ein und drücke Enter. Beim Tippen siehst du nichts, das ist normal.'
  hint 'Nimm ein Passwort, das du sonst nirgends verwendest (mindestens 12 Zeichen).'
  npx wrangler secret put APP_PASSWORD $W || fail 'Passwort konnte nicht gesetzt werden. Skript einfach erneut starten.'
fi

printf '\n\033[32mFertig!\033[0m\n'
echo 'Deine Adresse steht oben bei Schritt 5 (https://health-hub.<name>.workers.dev).'
echo 'Öffne sie, melde dich an und trage unter "Konto" deinen Garmin-Schlüssel ein.'
read -r -p "Enter zum Beenden"
