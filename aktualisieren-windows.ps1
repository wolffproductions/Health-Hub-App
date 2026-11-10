# Spielt eine neue Version ein. Daten, Garmin-Schluessel und Passwort bleiben erhalten.
# Aufruf im Ordner:  powershell -ExecutionPolicy Bypass -File .\aktualisieren-windows.ps1
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (Get-Command git -ErrorAction SilentlyContinue) { git pull --ff-only }
$idPath = Join-Path $PSScriptRoot '.d1-id'
if (-not (Test-Path $idPath)) { Write-Host 'Noch nicht eingerichtet - bitte zuerst einrichten-windows.ps1 ausfuehren.' -ForegroundColor Red; Read-Host 'Enter'; exit 1 }
$cfg = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wrangler.jsonc'))
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.local.jsonc'), $cfg.Replace('HIER_D1_ID_EINTRAGEN', [IO.File]::ReadAllText($idPath).Trim()), [Text.UTF8Encoding]::new($false))
npm install --no-fund --no-audit
npx wrangler d1 migrations apply health-hub --remote -c wrangler.local.jsonc
npx wrangler deploy -c wrangler.local.jsonc
Read-Host 'Enter zum Beenden'
