-- Near-duplicate stories and the stored daily paper. A `clusters` row groups
-- the articles of one edition that different sources wrote about the same
-- story (found by comparing their embeddings in Vectorize); each member points
-- at it through `articles.cluster_id`. `issues` keep the paper a person was
-- given each day: the laid-out front page as JSON and the editor's note, so
-- back issues read as they were printed.

CREATE TABLE clusters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  edition    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE articles ADD COLUMN cluster_id INTEGER;
CREATE INDEX idx_articles_cluster ON articles(cluster_id);

CREATE TABLE issues (
  user_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,
  layout     TEXT NOT NULL,
  briefing   TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
