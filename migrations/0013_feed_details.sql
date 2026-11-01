-- What each feed says about itself, read from its header on every fetch: the
-- typed details the app uses, and every header element as JSON (FeedElement[])
-- so nothing a feed declares is lost.
ALTER TABLE sources ADD COLUMN format TEXT;
ALTER TABLE sources ADD COLUMN site_url TEXT;
ALTER TABLE sources ADD COLUMN description TEXT;
ALTER TABLE sources ADD COLUMN language TEXT;
ALTER TABLE sources ADD COLUMN feed_updated_at TEXT;
ALTER TABLE sources ADD COLUMN update_minutes INTEGER;
ALTER TABLE sources ADD COLUMN header TEXT;

-- Titles that are only the address were never read from the feed; clear them
-- so the next fetch fills in the feed's own title.
UPDATE sources SET title = NULL WHERE title = url;
