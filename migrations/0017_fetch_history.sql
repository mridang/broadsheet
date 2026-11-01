-- The last fetches of each source, newest last: when, whether it worked and
-- why not. Kept to a few dozen per source by the code that writes them.
CREATE TABLE fetch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  fetched_at TEXT DEFAULT (datetime('now')),
  ok INTEGER NOT NULL,
  message TEXT
);
CREATE INDEX idx_fetch_history_source ON fetch_history (source_id, id);
