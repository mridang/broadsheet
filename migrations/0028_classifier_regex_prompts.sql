-- The rest of NewsBlur's training. A title, author, text or address
-- classifier can be a regular expression (`is_regex`). A `prompt` classifier
-- asks the AI whether a story matches its words; each answer is kept in
-- `prompt_scores` so a story is asked about once per prompt. A person can
-- also have stories marked read as they scroll past them.

ALTER TABLE classifiers ADD COLUMN is_regex INTEGER NOT NULL DEFAULT 0;

CREATE TABLE prompt_scores (
  classifier_id INTEGER NOT NULL,
  article_id    INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  matched       INTEGER NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (classifier_id, article_id)
);
CREATE INDEX idx_prompt_scores_user ON prompt_scores(user_id);

ALTER TABLE preferences ADD COLUMN mark_read_on_scroll INTEGER NOT NULL DEFAULT 0;
