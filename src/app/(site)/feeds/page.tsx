import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { FeedSummary } from '@/components/feeds/feed-summary';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { FeedSettingsForm } from '@/app/(site)/feeds/_components/feed-settings-form';
import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import { FeedHealth } from '@/app/(site)/feeds/_components/feed-health';
import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';
import { SuggestedFeeds } from '@/app/(site)/feeds/_components/suggested-feeds';
import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';

export const dynamic = 'force-dynamic';

/** The tab title of the feed manager. */
export const metadata: Metadata = { title: 'Your feeds' };

export default async function FeedsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const repo = new Repository(getDatabase());
  const [feeds, sections, suggestions] = await Promise.all([
    repo.listFeeds(user.id),
    repo.listSections(user.id),
    repo.suggestSources(user.id),
  ]);
  const stats = new Map(
    await Promise.all(
      feeds.map(
        async (f) =>
          [f.id, await repo.feedStatistics(user.id, f.id, 7)] as const,
      ),
    ),
  );
  const options = sections.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="panel">
      <h2>Your feeds</h2>
      <AddFeedForm />
      <p className="muted">
        Feeds are fetched &amp; scraped automatically every day.{' '}
        <RefreshFeedsButton /> <ExportFeedsButton />
      </p>
      {feeds.length ? (
        feeds.map((f) => (
          <div className="feedrow" key={f.id}>
            <div>
              <FeedSummary feed={f} />
              <p>
                <a className="btn ghost small" href={`/feeds/${f.id}`}>
                  Stories &amp; details →
                </a>
              </p>
              <FeedHealth statistics={stats.get(f.id)} />
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
      <SuggestedFeeds feeds={suggestions} />
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
