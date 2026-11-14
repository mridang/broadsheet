-- Bring the OAuth tables up to the shape the shared authorization server uses.
--
-- Every change is additive, so the clients, grants and tokens already stored
-- keep working and nobody has to approve an assistant again. The two columns
-- that cannot be null are given the value an existing row implies: a client
-- registered through the old server registered itself dynamically and proves
-- nothing when it asks for a token.

ALTER TABLE oauth_clients ADD COLUMN kind TEXT NOT NULL DEFAULT 'dynamic';
ALTER TABLE oauth_clients ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'none';
ALTER TABLE oauth_clients ADD COLUMN fetched_at TEXT;
ALTER TABLE oauth_clients ADD COLUMN expires_at TEXT;
ALTER TABLE oauth_clients ADD COLUMN jwks_uri TEXT;
ALTER TABLE oauth_clients ADD COLUMN logo_uri TEXT;

ALTER TABLE oauth_grants ADD COLUMN last_used_at TEXT;

ALTER TABLE oauth_codes ADD COLUMN grant_id TEXT;
ALTER TABLE oauth_codes ADD COLUMN redirect_uri_sent INTEGER;

ALTER TABLE oauth_tokens ADD COLUMN used_at INTEGER;

-- What a client signed to prove who it is, kept only until it expires so the
-- same assertion cannot be replayed.
CREATE TABLE IF NOT EXISTS oauth_assertions (
  jti TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_assertions_expires
  ON oauth_assertions (expires_at);
