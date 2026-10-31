-- A feed is fetched once however many people follow it. The per-person `feeds`
-- table splits into shared `sources` (one per address) and per-person
-- `subscriptions`, which keep the old feed ids so `/api/feeds/{id}` still names
-- the same thing. `sections` group a person's subscriptions on the front page.
-- Articles move from the feed to its source; where several people followed one
-- address, their copies of the same story collapse into one row.

CREATE TABLE sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL UNIQUE,
  title           TEXT,
  icon            TEXT,
  last_fetched_at TEXT,
  last_error      TEXT,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

INSERT INTO sources (url, title)
  SELECT url, MIN(title) FROM feeds GROUP BY url ORDER BY MIN(id);

CREATE TABLE sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_sections_user ON sections(user_id);

CREATE TABLE subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  source_id      INTEGER NOT NULL,
  section_id     INTEGER,
  title_override TEXT,
  muted          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, source_id)
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_source ON subscriptions(source_id);

INSERT INTO subscriptions (id, user_id, source_id, title_override, created_at)
  SELECT f.id, f.user_id, s.id,
         CASE WHEN f.title IS s.title THEN NULL ELSE f.title END,
         f.created_at
  FROM feeds f JOIN sources s ON s.url = f.url;

CREATE TABLE articles_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    INTEGER NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  source       TEXT,
  image        TEXT,
  favicon      TEXT,
  summary      TEXT,
  published_at TEXT,
  points       INTEGER DEFAULT 0,
  edition      TEXT,
  fetched_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (source_id, url, edition)
);

INSERT OR IGNORE INTO articles_new
  (id, source_id, url, title, source, image, favicon, summary, published_at,
   points, edition, fetched_at)
  SELECT a.id, s.id, a.url, a.title, a.source, a.image, a.favicon, a.summary,
         a.published_at, a.points, a.edition, a.fetched_at
  FROM articles a
  JOIN feeds f ON f.id = a.feed_id
  JOIN sources s ON s.url = f.url
  ORDER BY a.id;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;
CREATE INDEX idx_articles_source_edition ON articles(source_id, edition);
CREATE INDEX idx_articles_edition ON articles(edition);

DROP TABLE feeds;
