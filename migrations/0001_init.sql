-- Health Hub – Datenbankschema (Cloudflare D1 / SQLite)
-- Schemaänderungen immer als neue Datei 0002_..., 0003_... anlegen, diese hier nie ändern.

-- Kleiner Schlüssel-Wert-Speicher: verschlüsselter Garmin-Schlüssel, Token-Cache,
-- Sync-Status, Profil, Pulszonen, Login-Fehlversuche
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER              -- Unix-Sekunden, NULL = läuft nicht ab
);

-- Rohantworten der Quellen. Erlaubt späteres Neu-Auswerten ohne erneuten Abruf.
CREATE TABLE IF NOT EXISTS raw_records (
  source     TEXT NOT NULL,       -- 'garmin', später 'strava', 'withings'
  kind       TEXT NOT NULL,       -- 'dailysummaries', 'sleep', 'hrv', 'weight'
  range_key  TEXT NOT NULL,       -- 'YYYY-MM-DD_YYYY-MM-DD'
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, kind, range_key)
);

-- Ein Wert pro Tag, Metrik und Quelle. Welche Quelle gewinnt, steht in src/metrics.ts.
-- Metrik-Namen = Feldnamen der Oberfläche (rhr, hrv, slp, ...), Einheiten siehe src/garmin/extract.ts
CREATE TABLE IF NOT EXISTS daily_metrics (
  day        TEXT NOT NULL,
  metric     TEXT NOT NULL,
  source     TEXT NOT NULL,
  value      REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric, source)
);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_day ON daily_metrics (day);

-- Trainings. "data" ist das aufbereitete Objekt für die Oberfläche (JSON),
-- "payload" die Rohantwort der Quelle.
CREATE TABLE IF NOT EXISTS activities (
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  day         TEXT NOT NULL,
  type        TEXT,
  data        TEXT NOT NULL,
  laps        TEXT,               -- JSON-Array der Runden aus der .fit-Datei
  laps_done   INTEGER NOT NULL DEFAULT 0,
  file_key    TEXT,               -- R2-Key der Originaldatei (optional)
  payload     TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_activities_day ON activities (day);

-- Manuell eingetragene VO2max (die Garmin Personal API liefert sie nicht)
CREATE TABLE IF NOT EXISTS vo2 (
  day   TEXT NOT NULL,
  sport TEXT NOT NULL,            -- 'run' | 'ride'
  value REAL NOT NULL,
  PRIMARY KEY (day, sport)
);
