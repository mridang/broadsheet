import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/core/auth/current-user';
import { getDatabase } from '@/core/runtime';
import { Repository } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';

export const dynamic = 'force-dynamic';

/** The tab title of the feed manager. */
export const metadata: Metadata = { title: 'Your feeds' };

export default async function FeedsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const feeds = await new Repository(getDatabase()).listFeeds(user.id);

  return (
    <div className="panel">
      <h2>Your feeds</h2>
      <AddFeedForm />
      <p className="muted">
        Feeds are fetched &amp; scraped automatically every day.{' '}
        <RefreshFeedsButton />
      </p>
      {feeds.length ? (
        feeds.map((f) => (
          <div className="feedrow" key={f.id}>
            <div>
              <strong>{f.title || hostOf(f.url)}</strong>
              <div className="u">{f.url}</div>
            </div>
            <RemoveFeedButton id={f.id} />
          </div>
        ))
      ) : (
        <p className="muted">No feeds yet. Add an RSS/Atom feed URL above.</p>
      )}
      <p className="back">
        <a className="btn ghost" href="/">
          ← Back to the paper
        </a>
      </p>
    </div>
  );
}
