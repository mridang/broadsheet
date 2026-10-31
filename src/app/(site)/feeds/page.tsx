import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { FeedSettingsForm } from '@/app/(site)/feeds/_components/feed-settings-form';
import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';
import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';

export const dynamic = 'force-dynamic';

/** The tab title of the feed manager. */
export const metadata: Metadata = { title: 'Your feeds' };

export default async function FeedsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const repo = new Repository(getDatabase());
  const [feeds, sections] = await Promise.all([
    repo.listFeeds(user.id),
    repo.listSections(user.id),
  ]);
  const options = sections.map((s) => ({ id: s.id, name: s.name }));

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
              <FeedSettingsForm
                id={f.id}
                title={f.title ?? ''}
                muted={f.muted}
                sectionId={f.section_id}
                sections={options}
              />
            </div>
            <RemoveFeedButton id={f.id} />
          </div>
        ))
      ) : (
        <p className="muted">No feeds yet. Add an RSS/Atom feed URL above.</p>
      )}
      <h2>Sections</h2>
      <p className="muted">
        Sections group feeds under their own headings on the front page.
      </p>
      <AddSectionForm />
      {sections.map((s) => (
        <div className="feedrow" key={s.id}>
          <strong>{s.name}</strong>
          <RemoveSectionButton id={s.id} />
        </div>
      ))}
      <p className="back">
        <a className="btn ghost" href="/">
          ← Back to the paper
        </a>
      </p>
    </div>
  );
}
