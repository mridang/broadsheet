-- The archive: each article keeps the readable text of its page, and every
-- edition (none is ever pruned) can be searched by title, summary and text.
-- `articles_fts` is an external-content FTS5 index over `articles`; the
-- triggers keep it in step with every insert, update and delete.

ALTER TABLE articles ADD COLUMN body_text TEXT;

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title,
  summary,
  body_text,
  content = 'articles',
  content_rowid = 'id'
);

CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (rowid, title, summary, body_text)
    VALUES (new.id, new.title, new.summary, new.body_text);
END;

CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, summary, body_text)
    VALUES ('delete', old.id, old.title, old.summary, old.body_text);
END;

CREATE TRIGGER articles_fts_update AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, summary, body_text)
    VALUES ('delete', old.id, old.title, old.summary, old.body_text);
  INSERT INTO articles_fts (rowid, title, summary, body_text)
    VALUES (new.id, new.title, new.summary, new.body_text);
END;

INSERT INTO articles_fts (articles_fts) VALUES ('rebuild');
