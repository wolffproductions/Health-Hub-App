-- Sekundengenaue Pulsverteilung je Aktivität (#19): JSON [[bpm, Sekunden, Meter], …] aus der .fit-Datei.
-- Damit rechnet die App Zeit und Pace in den eigenen Zonen aus. Alle Dateien der Historie werden dafür
-- nach und nach erneut ausgewertet (neueste zuerst, 2 pro Sync).
ALTER TABLE activities ADD COLUMN hr_hist TEXT;
UPDATE activities SET route_done = 0;
