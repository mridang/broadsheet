-- Notifications on a classifier, as NewsBlur's classifier notifications are:
-- tell the person about any new story whose title, author, tag, text or
-- address matches `value` (a phrase, or a regular expression when `is_regex`),
-- in one feed (`subscription_id`), one section (`section_id`) or every feed,
-- by each of `channels` (a JSON array of web, email and webhook).
-- `user_activity` keeps the day each person last used the app, so nobody
-- away for 90 days keeps being notified.

CREATE TABLE notification_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  value           TEXT NOT NULL,
  is_regex        INTEGER NOT NULL DEFAULT 0,
  scope           TEXT NOT NULL DEFAULT 'all',
  subscription_id INTEGER,
  section_id      INTEGER,
  channels        TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_notification_rules_user ON notification_rules(user_id);

CREATE TABLE user_activity (
  user_id      INTEGER PRIMARY KEY,
  last_seen_on TEXT NOT NULL
);
