-- Recommended feeds, after NewsBlur's: anyone signed in may put a feed
-- forward with a description; a curator (an address in CURATOR_EMAILS)
-- approves or declines it. Approved ones are listed newest first, the newest
-- being the feed of the day.

CREATE TABLE feed_recommendations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  url         TEXT NOT NULL,
  title       TEXT,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now')),
  decided_at  TEXT
);
CREATE INDEX idx_feed_recommendations_status
  ON feed_recommendations(status, decided_at);
