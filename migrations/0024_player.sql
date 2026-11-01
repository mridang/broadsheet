-- Listening, as NewsBlur's media player keeps it: each person's playback rate,
-- the story being read and how far in (`position`, a character offset), and
-- the stories queued next and already heard (JSON arrays of article ids).
CREATE TABLE players (
  user_id INTEGER PRIMARY KEY,
  rate REAL NOT NULL DEFAULT 1,
  current_article_id INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  queue TEXT NOT NULL DEFAULT '[]',
  history TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);
