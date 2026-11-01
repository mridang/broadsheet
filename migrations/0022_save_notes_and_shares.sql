-- Notes and highlights on a saved story, and stories a person shares.
--
-- saves.notes: the person's own note on the story, or NULL.
-- saves.highlights: a JSON array of passages they marked.
-- shares: a story a person shared with an optional comment. Shares are
--   public: anyone can list them, with the sharer's name but never email.
ALTER TABLE saves ADD COLUMN notes TEXT;
ALTER TABLE saves ADD COLUMN highlights TEXT NOT NULL DEFAULT '[]';

CREATE TABLE shares (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  comments   TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, article_id)
);
CREATE INDEX idx_shares_created ON shares(created_at);
