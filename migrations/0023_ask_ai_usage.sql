-- Ask AI and the archive assistant, closer to NewsBlur. `answers` keeps each
-- preset answer a person was given about an article, so asking again is served
-- from here. `ai_usage` counts questions for the daily budgets (`kind` is
-- `answer` or `assistant`; a cached answer is noted but not counted).
-- Conversations get a title (from their first question) and the time of
-- their last turn, so they can be listed.

CREATE TABLE answers (
  user_id     INTEGER NOT NULL,
  article_id  INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id, question_id)
);

CREATE TABLE ai_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  cached     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_usage_user ON ai_usage(user_id, kind, created_at);

ALTER TABLE conversations ADD COLUMN title TEXT;
ALTER TABLE conversations ADD COLUMN updated_at TEXT;
UPDATE conversations SET updated_at = created_at;
