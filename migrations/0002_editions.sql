-- Daily editions: keep each day's scrape so readers can page back through
-- previous days. The same article URL can recur across days, so uniqueness
-- becomes (feed_id, url, edition) instead of (feed_id, url). SQLite can't drop
-- a constraint in place, so rebuild the table (preserving existing rows, dated
-- by their fetch day).

CREATE TABLE articles_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  source       TEXT,
  image        TEXT,
  favicon      TEXT,
  summary      TEXT,
  published_at TEXT,
  edition      TEXT,
  fetched_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (feed_id, url, edition)
);

INSERT INTO articles_new
  (id, feed_id, url, title, source, image, favicon, summary, published_at, edition, fetched_at)
  SELECT id, feed_id, url, title, source, image, favicon, summary, published_at,
         substr(fetched_at, 1, 10), fetched_at
  FROM articles;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

CREATE INDEX IF NOT EXISTS idx_articles_feed_edition ON articles (feed_id, edition);
CREATE INDEX IF NOT EXISTS idx_articles_edition ON articles (edition);
