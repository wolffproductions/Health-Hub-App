# Richtet Health Hub im eigenen Cloudflare-Konto ein (Windows).
# Aufruf im Ordner:  powershell -ExecutionPolicy Bypass -File .\einrichten-windows.ps1
# Kann gefahrlos mehrmals ausgefuehrt werden. (Bewusst ohne Umlaute: PowerShell 5.1 liest .ps1 ohne BOM als ANSI.)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Step($n, $text) { Write-Host ''; Write-Host "[$n/7] $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Read-Host 'Enter zum Beenden'; exit 1 }

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Fail 'Node.js wurde nicht gefunden. Installiere es mit "winget install OpenJS.NodeJS.LTS", starte den PC neu und fuehre das Skript erneut aus.'
}

Step 1 'Werkzeuge installieren (dauert etwa eine Minute) ...'
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Fail 'Installation fehlgeschlagen. Besteht eine Internetverbindung?' }

Step 2 'Bei Cloudflare anmelden ...'
$who = npx wrangler whoami 2>&1 | Out-String
if ($who -match 'not authenticated') {
    Write-Host 'Gleich oeffnet sich ein Browserfenster von Cloudflare. Klicke dort auf "Allow".' -ForegroundColor Yellow
    npx wrangler login
    if ($LASTEXITCODE -ne 0) { Fail 'Anmeldung fehlgeschlagen. Bitte Skript erneut starten und im Browser zuegig auf "Allow" klicken.' }
} else {
    Write-Host 'Bereits angemeldet.'
}

Step 3 'Datenbank anlegen ...'
# Die Datenbank-ID liegt in .d1-id (nicht in git), daraus entsteht wrangler.local.jsonc.
$idPath = Join-Path $PSScriptRoot '.d1-id'
if (-not (Test-Path $idPath) -or -not ([IO.File]::ReadAllText($idPath).Trim())) {
    $out = npx wrangler d1 create health-hub 2>&1 | Out-String
    $m = [regex]::Match($out, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    $id = $null
    if ($m.Success) { $id = $m.Value } else {
        try { $id = ((npx wrangler d1 list --json 2>$null | Out-String | ConvertFrom-Json) | Where-Object { $_.name -eq 'health-hub' }).uuid } catch {}
    }
    if (-not $id) { Write-Host $out; Fail 'Die Datenbank konnte nicht angelegt werden.' }
    [IO.File]::WriteAllText($idPath, $id, [Text.UTF8Encoding]::new($false))
    Write-Host 'Datenbank angelegt.'
} else {
    Write-Host 'Datenbank ist schon vorhanden.'
}
$cfg = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wrangler.jsonc'))
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.local.jsonc'), $cfg.Replace('HIER_D1_ID_EINTRAGEN', [IO.File]::ReadAllText($idPath).Trim()), [Text.UTF8Encoding]::new($false))

Step 4 'Datenbank-Tabellen anlegen ...'
npx wrangler d1 migrations apply health-hub --remote -c wrangler.local.jsonc
if ($LASTEXITCODE -ne 0) { Fail 'Tabellen konnten nicht angelegt werden.' }

Step 5 'App hochladen ...'
Write-Host 'Falls Cloudflare nach einer "workers.dev subdomain" fragt: Namen aus Kleinbuchstaben und Bindestrichen eingeben, z. B. "max-training" (nicht den vollen Namen).' -ForegroundColor Yellow
npx wrangler deploy -c wrangler.local.jsonc
if ($LASTEXITCODE -ne 0) { Fail 'Hochladen fehlgeschlagen. Siehe "Probleme" in ANLEITUNG.md.' }

$secrets = npx wrangler secret list -c wrangler.local.jsonc 2>$null | Out-String

Step 6 'Sitzungs-Geheimnis erzeugen ...'
if ($secrets -match '"SESSION_SECRET"') {
    Write-Host 'Schon vorhanden, bleibt unveraendert (sonst muesstest du den Garmin-Schluessel neu eintragen).'
} else {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes) | npx wrangler secret put SESSION_SECRET -c wrangler.local.jsonc
    if ($LASTEXITCODE -ne 0) { Fail 'Sitzungs-Geheimnis konnte nicht gesetzt werden.' }
}

Step 7 'App-Passwort festlegen ...'
if ($secrets -match '"APP_PASSWORD"') {
    Write-Host 'Schon vorhanden. Aendern geht jederzeit mit:  npx wrangler secret put APP_PASSWORD -c wrangler.local.jsonc'
} else {
    Write-Host 'Tippe gleich dein Passwort fuer die App ein und druecke Enter. Beim Tippen siehst du nichts, das ist normal.' -ForegroundColor Yellow
    Write-Host 'Nimm ein Passwort, das du sonst nirgends verwendest (mindestens 12 Zeichen).' -ForegroundColor Yellow
    npx wrangler secret put APP_PASSWORD -c wrangler.local.jsonc
    if ($LASTEXITCODE -ne 0) { Fail 'Passwort konnte nicht gesetzt werden. Skript einfach erneut starten.' }
}

Write-Host ''
Write-Host 'Fertig!' -ForegroundColor Green
Write-Host 'Deine Adresse steht oben bei Schritt 5 (https://health-hub.<name>.workers.dev).'
Write-Host 'Oeffne sie, melde dich an und trage unter "Konto" deinen Garmin-Schluessel ein.'
Read-Host 'Enter zum Beenden'
