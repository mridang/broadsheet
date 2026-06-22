// D1 data layer — the async port of the POC's db.mjs (node:sqlite).
import type { Article, Feed, OAuthProfile, ScrapedItem, User } from "./types";

export async function upsertUser(
  DB: D1Database,
  p: OAuthProfile,
): Promise<User> {
  return (await DB.prepare(
    `INSERT INTO users (sub, email, name, picture) VALUES (?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET
         email = excluded.email, name = excluded.name, picture = excluded.picture
       RETURNING *`,
  )
    .bind(p.sub, p.email, p.name, p.picture || "")
    .first<User>())!;
}

export function getUser(DB: D1Database, id: number): Promise<User | null> {
  return DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

export async function listFeeds(DB: D1Database, userId: number): Promise<Feed[]> {
  const { results } = await DB.prepare(
    "SELECT * FROM feeds WHERE user_id = ? ORDER BY created_at, id",
  )
    .bind(userId)
    .all<Feed>();
  return results;
}

export async function addFeed(
  DB: D1Database,
  userId: number,
  url: string,
  title?: string,
): Promise<Feed | null> {
  await DB.prepare(
    "INSERT OR IGNORE INTO feeds (user_id, url, title) VALUES (?, ?, ?)",
  )
    .bind(userId, url, title || url)
    .run();
  return DB.prepare("SELECT * FROM feeds WHERE user_id = ? AND url = ?")
    .bind(userId, url)
    .first<Feed>();
}

export async function removeFeed(
  DB: D1Database,
  userId: number,
  id: number,
): Promise<void> {
  await DB.prepare("DELETE FROM feeds WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
}

export async function allFeeds(DB: D1Database): Promise<Feed[]> {
  const { results } = await DB.prepare("SELECT * FROM feeds").all<Feed>();
  return results;
}

/** Replace a feed's article set atomically (delete + re-insert the current items). */
export async function replaceArticles(
  DB: D1Database,
  feedId: number,
  items: ScrapedItem[],
): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    DB.prepare("DELETE FROM articles WHERE feed_id = ?").bind(feedId),
  ];
  const ins = DB.prepare(
    `INSERT OR IGNORE INTO articles
       (feed_id, url, title, source, image, favicon, summary, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of items) {
    stmts.push(
      ins.bind(
        feedId,
        a.url,
        a.title,
        a.source || "",
        a.image || "",
        a.favicon || "",
        a.summary || "",
        a.published_at || "",
      ),
    );
  }
  await DB.batch(stmts);
}

export async function feedArticles(
  DB: D1Database,
  feedId: number,
): Promise<Article[]> {
  const { results } = await DB.prepare(
    "SELECT * FROM articles WHERE feed_id = ? ORDER BY published_at DESC, id DESC",
  )
    .bind(feedId)
    .all<Article>();
  return results;
}
