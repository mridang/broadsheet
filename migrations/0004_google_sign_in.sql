-- Sign in with Google, the same way chowdown does it. The Google account id moves
-- from `sub` to `google_sub`, the email becomes required, and each person gets a
-- session epoch: raising it ends every session they have ("sign out everywhere").
--
-- The passwordless dev login is gone, so the throwaway accounts it made
-- (`sub` of `dev:<email>`) can never be signed in to again. They are removed
-- here, with their feeds and articles, so the daily scrape stops fetching for
-- them. Real Google accounts and the public edition's system user keep their
-- ids, feeds and articles. SQLite cannot add NOT NULL in place, so the table is
-- rebuilt, as 0002 did for articles.

DELETE FROM articles WHERE feed_id IN (
  SELECT id FROM feeds WHERE user_id IN (
    SELECT id FROM users WHERE sub IS NULL OR sub LIKE 'dev:%'
  )
);
DELETE FROM feeds WHERE user_id IN (
  SELECT id FROM users WHERE sub IS NULL OR sub LIKE 'dev:%'
);
DELETE FROM users WHERE sub IS NULL OR sub LIKE 'dev:%';

CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT,
  picture       TEXT,
  session_epoch INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, google_sub, email, name, picture, created_at)
  SELECT id, sub, COALESCE(email, ''), name, picture, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
