-- What a person chooses about clustering and the editor's note. One row per
-- person, made the first time they change something; until then the defaults
-- below apply. `story_clustering` prints near-duplicates once; `cluster_mode`
-- 'title' folds only stories whose titles match, 'related' also folds those
-- the embeddings found; `cluster_mark_read` marks the other copies read when
-- one is opened. The briefing columns choose how many stories the note covers,
-- how long it is, how it is written and whether it covers only liked stories.
-- `briefing_stories` keeps, for each stored issue, the stories the note covers
-- and why each was picked (a JSON array of {id, category}).

CREATE TABLE preferences (
  user_id              INTEGER PRIMARY KEY,
  story_clustering     INTEGER NOT NULL DEFAULT 1,
  cluster_mode         TEXT NOT NULL DEFAULT 'related',
  cluster_mark_read    INTEGER NOT NULL DEFAULT 0,
  briefing_enabled     INTEGER NOT NULL DEFAULT 1,
  briefing_story_count INTEGER NOT NULL DEFAULT 5,
  briefing_length      TEXT NOT NULL DEFAULT 'medium',
  briefing_style       TEXT NOT NULL DEFAULT 'bullets',
  briefing_read_filter TEXT NOT NULL DEFAULT 'unread',
  updated_at           TEXT DEFAULT (datetime('now'))
);

ALTER TABLE issues ADD COLUMN briefing_stories TEXT;
ALTER TABLE edition_issues ADD COLUMN briefing_stories TEXT;
