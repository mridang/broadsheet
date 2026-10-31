-- What a person tells the paper about stories. `classifiers` train it: a like
-- or dislike for an author, a source (the site a story is from), a phrase in
-- the title or a tag. `saves` keep a story, with the person's own tags (a JSON
-- array), past the day its edition is replaced. `reads` note the stories a
-- person has opened, so later editions can leave them out.

CREATE TABLE classifiers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, kind, value)
);
CREATE INDEX idx_classifiers_user ON classifiers(user_id);

CREATE TABLE saves (
  user_id    INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX idx_saves_article ON saves(article_id);

CREATE TABLE reads (
  user_id    INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);
