-- Where a story is discussed (an RSS item's `<comments>`, or its Hacker News
-- thread), so the paper can open the discussion as NewsBlur's `c` does.
ALTER TABLE articles ADD COLUMN comments_url TEXT;
