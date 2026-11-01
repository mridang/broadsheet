-- WebSub (PubSubHubbub), as NewsBlur does it: a feed that names a hub is
-- subscribed to at that hub for `websub_topic` (its self link), and the hub
-- pushes new content to the callback, signed with `websub_secret`.
-- `websub_expires_at` is when the hub's lease runs out (UTC as
-- datetime('now') writes it); null while the hub has not verified the
-- subscription.

ALTER TABLE sources ADD COLUMN websub_hub TEXT;
ALTER TABLE sources ADD COLUMN websub_topic TEXT;
ALTER TABLE sources ADD COLUMN websub_secret TEXT;
ALTER TABLE sources ADD COLUMN websub_expires_at TEXT;
