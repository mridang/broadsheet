-- Dashboard rivers and read time.
--
-- `rivers` are the story lists a person pins to the left or right column of
-- their front page, in order. `river_id` names what each lists: `all`,
-- `saves`, or `feed:{id}`, `section:{id}`, `search:{id}` or `edition:{id}`.
--
-- `reads.seconds` is how long the person spent on the story, so trending can
-- rank well, long and good reads the way NewsBlur does.

CREATE TABLE rivers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  river_id   TEXT NOT NULL,
  side       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, side, position)
);

ALTER TABLE reads ADD COLUMN seconds INTEGER NOT NULL DEFAULT 0;
