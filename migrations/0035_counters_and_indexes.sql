-- Second pass at reading fewer rows (the first was 0034). Everything here is
-- additive except the one index it replaces.

-- reads had only (user_id, article_id) as its key, so every question of the
-- form "who read this story?" or "was this story read by anyone?" scanned the
-- whole table or built a throwaway index per query: the engagement counts of
-- the trending sites, and the stale-story delete of writeEdition. Reads are
-- written once, when a person opens a story, so this costs one index entry
-- per read.
CREATE INDEX idx_reads_article ON reads (article_id);

-- Expiring and rewriting clusters filters them by edition; with no index every
-- run read every cluster ever made.
CREATE INDEX idx_clusters_edition ON clusters (edition);

-- The daily email cap counts the person's emails of the last day. The key
-- (user_id, article_id) reads every delivery they ever had; this partial
-- index holds only emailed ones, in time order, so the count reads the last
-- day. It is partial on the literal `emailed = 1`, as the query is written.
CREATE INDEX idx_notification_deliveries_emailed
  ON notification_deliveries (user_id, created_at) WHERE emailed = 1;

-- Trending feeds and sites ask for the follows made since a date. The first
-- index finds them by time (with the source, so it is covering); the second
-- replaces idx_subscriptions_source and adds the time, so "has anyone followed
-- this source before that date?" is one index entry. created_at never changes
-- after the insert, so neither costs a write on update.
CREATE INDEX idx_subscriptions_created ON subscriptions (created_at, source_id);
DROP INDEX idx_subscriptions_source;
CREATE INDEX idx_subscriptions_source ON subscriptions (source_id, created_at);

-- The cluster of an article is rewritten for the whole window on every
-- clustering run, and the full-text trigger fired on every such update,
-- deleting and re-adding each article's text. Search only indexes five columns,
-- so the trigger now runs when one of them changed (a refetch of an unchanged
-- story no longer rewrites its text either). Same index contents as before.
DROP TRIGGER articles_fts_update;
CREATE TRIGGER articles_fts_update AFTER UPDATE ON articles
WHEN old.title IS NOT new.title
  OR old.summary IS NOT new.summary
  OR old.body_text IS NOT new.body_text
  OR old.author IS NOT new.author
  OR old.tags IS NOT new.tags
BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, summary, body_text, author, tags)
    VALUES ('delete', old.id, old.title, old.summary, old.body_text, old.author, old.tags);
  INSERT INTO articles_fts (rowid, title, summary, body_text, author, tags)
    VALUES (new.id, new.title, new.summary, new.body_text, new.author, new.tags);
END;

-- Denormalised counters on the source, so a page does not count rows to show
-- them. Each is kept by triggers in the same transaction as the rows it
-- summarises, so it cannot drift, and is backfilled below from the tables.
--
-- follower_count: how many subscriptions point at the source. It replaces a
-- count over subscriptions per source in the trending, discover and activity
-- queries and in every page that lists followers.
-- story_count: how many distinct story addresses the source has kept (a story
-- stored again in later editions counts once), which the feed list showed by
-- reading every article of every followed source on every page.
ALTER TABLE sources ADD COLUMN follower_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN story_count INTEGER NOT NULL DEFAULT 0;

UPDATE sources SET
  follower_count = (SELECT count(*) FROM subscriptions WHERE source_id = sources.id),
  story_count = (SELECT count(DISTINCT url) FROM articles WHERE source_id = sources.id);

-- The most followed sources, most first (the discover lists and the search of
-- sources): ordered by the counter, so the first rows are the answer.
CREATE INDEX idx_sources_followers ON sources (follower_count DESC, id);

CREATE TRIGGER subscriptions_follower_insert AFTER INSERT ON subscriptions BEGIN
  UPDATE sources SET follower_count = follower_count + 1 WHERE id = new.source_id;
END;

CREATE TRIGGER subscriptions_follower_delete AFTER DELETE ON subscriptions BEGIN
  UPDATE sources SET follower_count = follower_count - 1 WHERE id = old.source_id;
END;

CREATE TRIGGER subscriptions_follower_move AFTER UPDATE OF source_id ON subscriptions
WHEN old.source_id IS NOT new.source_id
BEGIN
  UPDATE sources SET follower_count = follower_count - 1 WHERE id = old.source_id;
  UPDATE sources SET follower_count = follower_count + 1 WHERE id = new.source_id;
END;

-- A story address counts once per source however many editions carry it, so
-- the counter moves only when the first row of an address arrives or the last
-- one goes. The probes use the unique key (source_id, url, edition).
CREATE TRIGGER articles_story_insert AFTER INSERT ON articles
WHEN NOT EXISTS (
  SELECT 1 FROM articles WHERE source_id = new.source_id AND url = new.url AND id <> new.id
)
BEGIN
  UPDATE sources SET story_count = story_count + 1 WHERE id = new.source_id;
END;

CREATE TRIGGER articles_story_delete AFTER DELETE ON articles
WHEN NOT EXISTS (
  SELECT 1 FROM articles WHERE source_id = old.source_id AND url = old.url
)
BEGIN
  UPDATE sources SET story_count = story_count - 1 WHERE id = old.source_id;
END;

-- A story renamed to a new address (the feed's own id stayed) leaves one
-- address and joins another.
CREATE TRIGGER articles_story_move AFTER UPDATE OF url, source_id ON articles
WHEN old.url IS NOT new.url OR old.source_id IS NOT new.source_id
BEGIN
  UPDATE sources SET story_count = story_count - 1
    WHERE id = old.source_id
      AND NOT EXISTS (SELECT 1 FROM articles WHERE source_id = old.source_id AND url = old.url);
  UPDATE sources SET story_count = story_count + 1
    WHERE id = new.source_id
      AND NOT EXISTS (
        SELECT 1 FROM articles WHERE source_id = new.source_id AND url = new.url AND id <> new.id
      );
END;

-- sourceActivity (run after every fetch, to schedule the next) counted the
-- distinct stories of the last 30 days and found the newest by reading every
-- article the source ever kept. A count over a rolling window changes with the
-- clock alone, so no stored counter can hold it; this index lets it read only
-- the last 30 days. It is keyed by the expression the query uses (the story's
-- date: published_at, else fetched_at) and carries url so it is covering.
-- Cost: refetching a story rewrites fetched_at, so each upsert also rewrites
-- this entry (one more index write per listed story per fetch); drop the index
-- if writes ever cost more than the reads it saves.
CREATE INDEX idx_articles_source_published
  ON articles (source_id, julianday(coalesce(nullif(published_at, ''), fetched_at)), url);
