-- The archive assistant. A `conversations` row is one exchange a person has
-- with it; `messages` are its turns, the person's questions and its answers,
-- with `citations` a JSON array of the article ids an answer drew on.

CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_conversations_user ON conversations(user_id);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  citations       TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
