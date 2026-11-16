# Spielt eine neue Version ein. Daten, Garmin-Schluessel und Passwort bleiben erhalten.
# Aufruf im Ordner:  powershell -ExecutionPolicy Bypass -File .\aktualisieren-windows.ps1
Set-Location $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $PSScriptRoot '.git'))) {
  # npm install veraendert package-lock.json; diese Aenderung wuerde den Pull blockieren, also vorher zuruecksetzen
  git checkout -- package-lock.json 2>$null
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'Die neue Version konnte nicht geladen werden (git pull ist gescheitert). Abgebrochen, es wurde nichts eingespielt.' -ForegroundColor Red
    Write-Host 'Haeufige Gruende: keine Internetverbindung, oder im Ordner wurden Dateien geaendert (dann: git status).'
    Read-Host 'Enter zum Beenden'; exit 1
  }
} else {
  Write-Host 'Kein git-Ordner oder git fehlt, eine neue Version kann ich nicht laden.' -ForegroundColor Yellow
  $antwort = Read-Host 'Stand einspielen, der gerade im Ordner liegt? (j/n)'
  if ($antwort -ne 'j') { exit 1 }
}
$idPath = Join-Path $PSScriptRoot '.d1-id'
if (-not (Test-Path $idPath)) { Write-Host 'Noch nicht eingerichtet - bitte zuerst einrichten-windows.ps1 ausfuehren.' -ForegroundColor Red; Read-Host 'Enter'; exit 1 }
$cfg = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wrangler.jsonc'))
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.local.jsonc'), $cfg.Replace('HIER_D1_ID_EINTRAGEN', [IO.File]::ReadAllText($idPath).Trim()), [Text.UTF8Encoding]::new($false))
# Bei einem Fehler nicht weitermachen (sonst laeuft z. B. das Deploy ohne die neuen Migrationen)
npm install --no-fund --no-audit
if ($LASTEXITCODE -eq 0) { npx wrangler d1 migrations apply health-hub --remote -c wrangler.local.jsonc }
if ($LASTEXITCODE -eq 0) { npx wrangler deploy -c wrangler.local.jsonc }
if ($LASTEXITCODE -ne 0) { Write-Host 'Fehler, siehe oben. Es wurde nicht (vollstaendig) eingespielt.' -ForegroundColor Red }
Read-Host 'Enter zum Beenden'
