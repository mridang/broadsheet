import { redirect } from 'next/navigation';

import { currentUser, db } from '@/lib/account';
import { listFeeds } from '@/lib/repository';
import { hostOf } from '@/lib/render/tiers';

export const dynamic = 'force-dynamic';

export default async function FeedsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const feeds = await listFeeds(db(), user.id);

  return (
    <div className="panel">
      <h2>Your feeds</h2>
      <form className="addform" method="post" action="/api/feeds">
        <input
          name="url"
          type="url"
          placeholder="https://example.com/feed.xml"
          required
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      <p className="muted">
        Feeds are fetched &amp; scraped automatically every day.{' '}
        <form style={{ display: 'inline' }} method="post" action="/api/refresh">
          <button
            className="btn ghost"
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            Refresh now
          </button>
        </form>
      </p>
      {feeds.length ? (
        feeds.map((f) => (
          <div className="feedrow" key={f.id}>
            <div>
              <strong>{f.title || hostOf(f.url)}</strong>
              <div className="u">{f.url}</div>
            </div>
            <form method="post" action={`/api/feeds/${f.id}/delete`}>
              <button className="btn danger">Remove</button>
            </form>
          </div>
        ))
      ) : (
        <p className="muted">No feeds yet. Add an RSS/Atom feed URL above.</p>
      )}
      <p style={{ marginTop: '24px' }}>
        <a className="btn ghost" href="/">
          ← Back to the paper
        </a>
      </p>
    </div>
  );
}
