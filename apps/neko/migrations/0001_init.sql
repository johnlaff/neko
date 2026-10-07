-- One row per computed projection. The sheet is the source of truth; this is a cache plus the
-- history behind "como a previsão evoluiu".
CREATE TABLE snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  file_version TEXT NOT NULL,
  today TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  month_end_projected INTEGER,
  projection TEXT NOT NULL
);
CREATE INDEX snapshot_lookup ON snapshot (file_version, today, settings_hash);
CREATE INDEX snapshot_today ON snapshot (today);

CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
