-- Training data and reading preferences, to NewsBlur's model.
--
-- Articles keep the author and the categories their feed gave, so classifiers
-- can match them. A classifier can be scoped to one feed or one section
-- (NewsBlur's feed and folder scopes) or apply everywhere, and a score of -2
-- is a super dislike that beats any like; the old one-per-value uniqueness
-- gives way to one per value and scope, so the table is rebuilt.
--
-- A person picks how much of the paper training lets through (`intelligence`:
-- focus, unread or all), whether opening a story marks it read, and after how
-- many days stories count as read anyway when no feed or section says (0
-- never).

ALTER TABLE articles ADD COLUMN author TEXT;
ALTER TABLE articles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

CREATE TABLE classifiers_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  value            TEXT NOT NULL,
  score            INTEGER NOT NULL,
  scope_feed_id    INTEGER,
  scope_section_id INTEGER,
  created_at       TEXT DEFAULT (datetime('now'))
);
INSERT INTO classifiers_new (id, user_id, kind, value, score, created_at)
  SELECT id, user_id, kind, value, score, created_at FROM classifiers;
DROP TABLE classifiers;
ALTER TABLE classifiers_new RENAME TO classifiers;
CREATE INDEX idx_classifiers_user ON classifiers(user_id);

ALTER TABLE preferences ADD COLUMN intelligence TEXT NOT NULL DEFAULT 'unread';
ALTER TABLE preferences ADD COLUMN mark_read_on_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE preferences ADD COLUMN auto_mark_read_days INTEGER NOT NULL DEFAULT 0;
