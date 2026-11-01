-- Feed organisation as NewsBlur has it: sections nest under other sections,
-- feeds keep the order the person gives them, and a mute can run out on its
-- own (`muted_until`, UTC as datetime('now') writes it; null mutes for good).
ALTER TABLE sections ADD COLUMN parent_id INTEGER;
ALTER TABLE subscriptions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN muted_until TEXT;
