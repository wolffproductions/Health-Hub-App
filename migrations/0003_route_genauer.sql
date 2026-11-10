-- Genauere Routen: statt 200 gleichmäßig verteilter Punkte jetzt Douglas-Peucker mit höchstens
-- 2,5 m Abweichung (Kurven und Ecken bleiben erhalten). Vorhandene Routen neu auswerten lassen;
-- der Sync lädt die .fit-Dateien der letzten 90 Tage dafür nach und nach erneut (neueste zuerst).
UPDATE activities SET route_done = 0 WHERE route_done = 1;
