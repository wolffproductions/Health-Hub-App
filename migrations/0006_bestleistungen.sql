-- Bestleistungen je Einheit (wie bei Strava): schnellste Zeit je Strecke und höchste Durchschnittsleistung je
-- Zeitfenster, aus allen Messpunkten der .fit-Datei, als JSON {d: {Meter: Sekunden}, p: {Sekunden: Watt}}.
-- Läufe und Radfahrten werten ihre Datei dafür noch einmal aus (aus R2, falls gespeichert, sonst neu von Garmin,
-- neueste zuerst, 4 pro Sync-Lauf).
ALTER TABLE activities ADD COLUMN best TEXT;
UPDATE activities SET route_done = 0
  WHERE source = 'garmin' AND (type LIKE '%running%' OR type LIKE '%cycl%' OR type LIKE '%bik%' OR type LIKE '%ride%');
