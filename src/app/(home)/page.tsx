import { currentUser, db, ensurePublicUser } from '@/lib/account';
import { feedArticles, listFeeds } from '@/lib/repository';
import { Section } from './_components/section';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  const database = db();
  // Logged-out visitors read the hidden public user's Hacker News edition.
  const ownerId = user ? user.id : await ensurePublicUser();
  const feeds = await listFeeds(database, ownerId);
  const sections = await Promise.all(
    feeds.map(async (feed) => ({
      feed,
      articles: await feedArticles(database, feed.id),
    })),
  );

  if (!sections.length) {
    return (
      <div className="panel">
        <h2>No feeds yet</h2>
        <p className="muted">Sign in and add some feeds to build your paper.</p>
        <p>
          <a className="btn" href="/feeds">
            Manage feeds →
          </a>
        </p>
      </div>
    );
  }

  return (
    <>
      {sections.map(({ feed, articles }) => (
        <Section key={feed.id} feed={feed} articles={articles} />
      ))}
      <div className="foot">
        THE HACKER TIMES — auto-generated from your feeds, refreshed daily.
      </div>
      <div className="enginenote">
        Generative layout: weight → tier → copyfit, with an In Brief rail for
        the low-weight tail.
      </div>
    </>
  );
}
