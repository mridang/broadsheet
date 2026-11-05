-- The five-minute cron lists the sources due a fetch by next_fetch_at (NULL, or
-- a UTC datetime already past). Without this index it read every followed source
-- on every run and filtered them in code; with it, it reads only the due ones.
CREATE INDEX idx_sources_next_fetch ON sources (next_fetch_at);

-- sourceActivity counts the feeds notifying about one source by joining
-- feed_notifications on subscription_id. Its primary key leads with user_id, so
-- that join scanned the whole table once per source; this index makes it a search.
CREATE INDEX idx_feed_notifications_subscription ON feed_notifications (subscription_id);
