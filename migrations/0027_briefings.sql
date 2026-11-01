-- The rest of NewsBlur's briefing and clustering settings, and the briefings
-- themselves. A person picks how often a briefing comes (daily, twice or
-- three times a day, weekly), at what time of their day and on which weekday,
-- in their time zone; which feeds it reads (all, or one section and those
-- nested in it); whether stories they already read may be covered; the
-- Workers AI model that writes it; which sections it has and in what order
-- (a JSON object of section to on/off, and a JSON array of section keys); and
-- up to five keyword prompts of their own (a JSON array). `cluster_preview_style`
-- chooses whether the copies of a story show as one line or with a picture
-- and opening.
--
-- `briefings` keeps every briefing written: the slot of the day and the local
-- date it is for (one per slot and day), what it covers and why, the sections
-- it has, the note, and how it was written (model, tokens, seconds).

ALTER TABLE preferences ADD COLUMN briefing_frequency TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE preferences ADD COLUMN briefing_time TEXT NOT NULL DEFAULT 'morning';
ALTER TABLE preferences ADD COLUMN briefing_day TEXT NOT NULL DEFAULT 'sun';
ALTER TABLE preferences ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE preferences ADD COLUMN briefing_sources TEXT NOT NULL DEFAULT 'all';
ALTER TABLE preferences ADD COLUMN briefing_include_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE preferences ADD COLUMN briefing_model TEXT;
ALTER TABLE preferences ADD COLUMN briefing_sections TEXT;
ALTER TABLE preferences ADD COLUMN briefing_section_order TEXT;
ALTER TABLE preferences ADD COLUMN briefing_prompts TEXT;
ALTER TABLE preferences ADD COLUMN cluster_preview_style TEXT NOT NULL DEFAULT 'single_line';

CREATE TABLE briefings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  slot         TEXT NOT NULL,
  local_date   TEXT NOT NULL,
  frequency    TEXT NOT NULL,
  period_start TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  stories      TEXT NOT NULL DEFAULT '[]',
  sections     TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL,
  error        TEXT,
  model        TEXT,
  tokens       INTEGER,
  seconds      REAL,
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, slot, local_date)
);
CREATE INDEX idx_briefings_user ON briefings(user_id, created_at);
