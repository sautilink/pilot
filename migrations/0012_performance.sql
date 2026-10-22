CREATE TABLE IF NOT EXISTS pilot_performance_buckets (
  bucket INTEGER NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL, kind TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
  slow INTEGER NOT NULL DEFAULT 0, queue_ms INTEGER NOT NULL DEFAULT 0, db_ms INTEGER NOT NULL DEFAULT 0,
  telegram_ms INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket,route,release,kind)
);
CREATE TABLE IF NOT EXISTS pilot_performance_histograms (
  bucket INTEGER NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL,
  metric TEXT NOT NULL, upper_ms INTEGER NOT NULL, observations INTEGER NOT NULL,
  PRIMARY KEY(bucket,route,release,metric,upper_ms)
);
CREATE TABLE IF NOT EXISTS pilot_performance_preferences (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), alerts_enabled INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en', last_alert_at INTEGER NOT NULL DEFAULT 0,
  last_alert_status TEXT, updated_at INTEGER NOT NULL
);
