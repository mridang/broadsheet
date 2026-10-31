-- Custom editions: named papers a person keeps beside their default one (a
-- "Weekend" paper, say). Each carries rules that pick its stories: the
-- sections whose feeds it prints (`section_ids`, a JSON array; empty means
-- every feed), a saved search (`query`) and a save tag (`tag`). The daily run
-- stores one issue per edition per day in `edition_issues`, beside the default
-- edition's `issues`.

CREATE TABLE editions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  section_ids TEXT NOT NULL DEFAULT '[]',
  query       TEXT,
  tag         TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_editions_user ON editions(user_id);

CREATE TABLE edition_issues (
  edition_id INTEGER NOT NULL,
  date       TEXT NOT NULL,
  layout     TEXT NOT NULL,
  briefing   TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (edition_id, date)
);

-- Trending ranks reads and saves inside a time window.
CREATE INDEX idx_reads_created ON reads(created_at);
CREATE INDEX idx_saves_created ON saves(created_at);
