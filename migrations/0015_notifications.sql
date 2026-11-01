-- Telling people about new stories, as NewsBlur does. `feed_notifications`
-- says which of a person's feeds notify them (`filter` unread: anything not
-- disliked, or focus: only liked stories) and how (`channels`, a JSON array of
-- web, email and webhook). `notification_deliveries` remembers each story a
-- person was told about, so a rerun of the scrape tells nobody twice, and
-- whether it went by email, for the daily email cap. `story_emails` counts the
-- stories a person emailed to others, for their daily quota. A feed token
-- may now leave out disliked stories (unread) or keep only liked ones (focus).

CREATE TABLE feed_notifications (
  user_id         INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  filter          TEXT NOT NULL DEFAULT 'unread',
  channels        TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, subscription_id)
);

CREATE TABLE notification_deliveries (
  user_id    INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  emailed    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE story_emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  recipients INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_story_emails_user ON story_emails(user_id, created_at);

ALTER TABLE feed_tokens ADD COLUMN filter TEXT NOT NULL DEFAULT 'all';
