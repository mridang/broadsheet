-- The rest of NewsBlur's folders. A feed can sit in several sections: its
-- `section_id` is where the paper prints it, and `subscription_sections` holds
-- the others. Sections and feeds take a custom icon (JSON: type, data, color,
-- set), and either can say after how many days its stories count as read
-- (`auto_mark_read_days`: null inherits, 0 never, 1-365).
CREATE TABLE subscription_sections (
  subscription_id INTEGER NOT NULL,
  section_id      INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, section_id)
);
CREATE INDEX idx_subscription_sections_section ON subscription_sections(section_id);

ALTER TABLE sections ADD COLUMN icon TEXT;
ALTER TABLE sections ADD COLUMN auto_mark_read_days INTEGER;
ALTER TABLE subscriptions ADD COLUMN custom_icon TEXT;
ALTER TABLE subscriptions ADD COLUMN auto_mark_read_days INTEGER;
