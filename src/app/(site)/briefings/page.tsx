import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { parseBriefedStories } from '@/domain/briefing';
import { paragraphs } from '@/app/(site)/briefings/_components/briefing-view';
import { WriteBriefing } from '@/app/(site)/briefings/_components/write-briefing';
import { buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** The tab title of the briefings. */
export const metadata: Metadata = { title: 'Briefings' };

/** How many briefings a page lists. */
const PAGE = 20;

/** The `before` parameter as a briefing id, or undefined. */
function beforeOf(raw: string | undefined): number | undefined {
  return raw && /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : undefined;
}

/**
 * The person's briefings, newest first, a page at a time: each one's title,
 * when it is for, whether it was written, how many stories it covers and how
 * it opens, with a button to write one now.
 */
export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const before = beforeOf((await searchParams).before);
  const rows = await new Repository(getDatabase()).listBriefings(
    user.id,
    PAGE + 1,
    before,
  );
  const items = rows.slice(0, PAGE);
  const next = rows.length > PAGE ? items.at(-1)?.id : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Briefings"
        description="A short editor’s note on the stories that matter, written for your morning, midday and evening."
        actions={<WriteBriefing />}
      />
      {items.length ? (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {items.map((b) => {
            const count = parseBriefedStories(b.stories).length;
            const failed = b.status !== 'complete';
            const opening = paragraphs(b.summary)[0];
            return (
              <li key={b.id} className="py-5">
                <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-subtle">
                  <span>{b.local_date}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{b.slot}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {count} {count === 1 ? 'story' : 'stories'}
                  </span>
                  <Badge tone={failed ? 'danger' : 'neutral'} className="ml-1">
                    {failed ? 'Failed' : 'Written'}
                  </Badge>
                </p>
                <a
                  href={`/briefings/${b.id}`}
                  className="focus-ring mt-1 block rounded-sm text-base leading-snug font-semibold text-ink hover:text-accent sm:text-lg"
                >
                  {b.title}
                </a>
                {opening ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                    {opening}
                  </p>
                ) : failed && b.error ? (
                  <p className="mt-1 text-sm text-muted">{b.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-8">
          <EmptyState icon="briefing" title="No briefings yet">
            Your first briefing is written at the next slot of your day, or now
            with the button above.
          </EmptyState>
        </div>
      )}
      {before !== undefined || next !== undefined ? (
        <nav aria-label="Older and newer briefings" className="mt-6 flex gap-2">
          {before !== undefined ? (
            <a
              className={buttonClass({ variant: 'outline', size: 'sm' })}
              href="/briefings"
            >
              Newest
            </a>
          ) : null}
          {next !== undefined ? (
            <a
              className={buttonClass({ variant: 'outline', size: 'sm' })}
              href={`/briefings?before=${next}`}
            >
              Older briefings
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
