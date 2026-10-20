-- HN points (upvotes) per article. Generic feeds have none, so default 0.
ALTER TABLE articles ADD COLUMN points INTEGER DEFAULT 0;
