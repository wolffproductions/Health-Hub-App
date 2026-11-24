-- „Wann zuletzt aktualisiert?“ (SELECT MAX(updated_at) FROM daily_metrics) läuft bei jedem Laden der App.
-- Ohne Index liest D1 dafür die ganze Tabelle (bei Eddie ~9.700 Zeilen je Aufruf, 4,6 Mio. gelesene Zeilen in 2 Tagen,
-- fast das ganze Tageslimit von 5 Mio. im kostenlosen Tarif). Mit Index reicht eine Zeile.
CREATE INDEX IF NOT EXISTS idx_daily_metrics_updated ON daily_metrics (updated_at);
