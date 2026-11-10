-- Verläufe über die Strecke (#17): Pace/Tempo, Puls, Höhe, Kadenz, Leistung aus der .fit-Datei,
-- auf höchstens 400 Abschnitte gemittelt, als JSON {d, t, v, hr, alt, cad, pw}.
-- Die Dateien der letzten 90 Tage werden dafür nach und nach neu ausgewertet (aus R2, falls dort
-- gespeichert, sonst neu von Garmin, neueste zuerst, 2 pro Sync).
ALTER TABLE activities ADD COLUMN streams TEXT;
UPDATE activities SET route_done = 0;
