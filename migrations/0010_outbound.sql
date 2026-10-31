-- What leaves the paper on a person's behalf. `push_subscriptions` are the
-- browsers that asked to be told when a day's issue is ready (the endpoint and
-- the keys the browser gave). `webhooks` are addresses told when the person
-- saves or likes something, signed with the hook's own secret. `feed_tokens`
-- let a feed reader fetch `/feed.xml` without a session: only the SHA-256 of
-- the token is kept, with what the feed shows (saved stories, optionally one
-- tag; one section; or the whole edition).

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL DEFAULT '[]',
  secret     TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhooks_user ON webhooks(user_id);

CREATE TABLE feed_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope      TEXT NOT NULL,
  tag        TEXT,
  section_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_feed_tokens_user ON feed_tokens(user_id);
