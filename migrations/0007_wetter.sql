-- Wetter je Einheit (#54) von Open-Meteo, nur mit Haken unter Konto → Datenquellen → Wetter. JSON {t, ta, hu, ws, wd, c},
-- „{}“ = kein Wetter (z. B. ohne Route). Eigene Spalte, weil der Sync `data` überschreibt.
ALTER TABLE activities ADD COLUMN weather TEXT;
