-- Fetching as NewsBlur does it: each source keeps the validators of its last
-- answer (`etag`, `last_modified`) for a conditional GET, and when it may be
-- fetched again (`next_fetch_at`, UTC as datetime('now') writes it; null is
-- now), which backs off while it keeps failing. Saved searches are a person's
-- archive searches, optionally within one of their feeds.

ALTER TABLE sources ADD COLUMN etag TEXT;
ALTER TABLE sources ADD COLUMN last_modified TEXT;
ALTER TABLE sources ADD COLUMN next_fetch_at TEXT;

CREATE TABLE saved_searches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  query      TEXT NOT NULL,
  feed_id    INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_saved_searches_unique
  ON saved_searches(user_id, query, ifnull(feed_id, 0));
