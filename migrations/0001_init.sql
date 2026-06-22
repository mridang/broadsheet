-- The Hacker Times schema (mirrors the POC's db.mjs, D1/SQLite-compatible).

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sub        TEXT UNIQUE,
  email      TEXT,
  name       TEXT,
  picture    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feeds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  url        TEXT NOT NULL,
  title      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, url)
);

CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  source       TEXT,
  image        TEXT,
  favicon      TEXT,
  summary      TEXT,
  published_at TEXT,
  fetched_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (feed_id, url)
);

CREATE INDEX IF NOT EXISTS idx_feeds_user ON feeds (user_id);
CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles (feed_id);
