-- Search by author and tag, as NewsBlur's: `articles_fts` also indexes each
-- article's author and its feed's tags, so `author:` and `tag:` terms can
-- match those columns alone and plain words match them too.

DROP TRIGGER articles_fts_insert;
DROP TRIGGER articles_fts_delete;
DROP TRIGGER articles_fts_update;
DROP TABLE articles_fts;

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title,
  summary,
  body_text,
  author,
  tags,
  content = 'articles',
  content_rowid = 'id'
);

CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (rowid, title, summary, body_text, author, tags)
    VALUES (new.id, new.title, new.summary, new.body_text, new.author, new.tags);
END;

CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, summary, body_text, author, tags)
    VALUES ('delete', old.id, old.title, old.summary, old.body_text, old.author, old.tags);
END;

CREATE TRIGGER articles_fts_update AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, summary, body_text, author, tags)
    VALUES ('delete', old.id, old.title, old.summary, old.body_text, old.author, old.tags);
  INSERT INTO articles_fts (rowid, title, summary, body_text, author, tags)
    VALUES (new.id, new.title, new.summary, new.body_text, new.author, new.tags);
END;

INSERT INTO articles_fts (articles_fts) VALUES ('rebuild');
