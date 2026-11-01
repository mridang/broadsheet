-- Stories as NewsBlur tells them apart: the feed's own id for each (`guid`),
-- so a story whose address changes is still the same story, and the summary
-- it first had (`original_summary`), kept once a later fetch changes it.
-- A feed token can follow a saved search (`search_id`).

ALTER TABLE articles ADD COLUMN guid TEXT;
ALTER TABLE articles ADD COLUMN original_summary TEXT;
ALTER TABLE feed_tokens ADD COLUMN search_id INTEGER;
