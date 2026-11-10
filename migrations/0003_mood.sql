-- Stimmung (#Balance): ein Eintrag pro Tag, 1 (sehr schlecht) bis 5 (sehr gut), optionale Stichworte
-- (JSON-Array) und eine kurze Notiz. Bleibt wie alles andere nur in der eigenen Instanz.
CREATE TABLE IF NOT EXISTS mood (
  day        TEXT PRIMARY KEY,
  value      INTEGER NOT NULL,
  tags       TEXT,
  note       TEXT,
  updated_at INTEGER NOT NULL
);
