-- A large OPML import runs in a Workflow (FeedImportRun), a chunk of feeds at
-- a time; this row is its progress, read back at /api/feeds/imports/:id.
-- `status` is `running` until the run is `complete` or `failed`. Finished
-- imports and expired OAuth codes and tokens are deleted on the cron.

CREATE TABLE feed_imports (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running',
  total          INTEGER NOT NULL,
  processed      INTEGER NOT NULL DEFAULT 0,
  added          INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  sections_added INTEGER NOT NULL DEFAULT 0,
  rejected       TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT DEFAULT (datetime('now')),
  finished_at    TEXT
);
CREATE INDEX idx_feed_imports_finished ON feed_imports(finished_at);
CREATE INDEX idx_oauth_tokens_expires ON oauth_tokens(expires_at);
CREATE INDEX idx_oauth_codes_expires ON oauth_codes(expires_at);
