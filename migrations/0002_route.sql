-- Route aus der .fit-Datei (#16): vereinfachte GPS-Spur als JSON [[Breite, Länge], …],
-- höchstens 200 Punkte. Leer ("[]") bei Aktivitäten ohne GPS.
ALTER TABLE activities ADD COLUMN route TEXT;
ALTER TABLE activities ADD COLUMN route_done INTEGER NOT NULL DEFAULT 0;
