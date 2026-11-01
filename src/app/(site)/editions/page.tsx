import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import {
  BLANK,
  EditionForm,
} from '@/app/(site)/editions/_components/edition-form';
import { RemoveEditionButton } from '@/app/(site)/editions/_components/remove-edition-button';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { CARD } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/notice';

export const dynamic = 'force-dynamic';

/** The tab title of the edition manager. */
export const metadata: Metadata = { title: 'Your editions' };

/**
 * The edition manager: the named papers a person keeps beside their daily
 * one, each editable in place, and a form to add another.
 */
export default async function EditionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const repo = new Repository(getDatabase());
  const [editions, sections] = await Promise.all([
    repo.listCustomEditions(user.id),
    repo.listSections(user.id),
  ]);
  const options = sections.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Your editions"
        description="Each edition is its own paper, laid out every day from the stories its rules pick."
      />
      {editions.length ? null : (
        <div className="mt-8">
          <EmptyState title="No editions yet">
            Make one below to get a second paper beside your daily one.
          </EmptyState>
        </div>
      )}
      <ul className="mt-8 space-y-3">
        {editions.map((e) => (
          <li className={`${CARD} flex items-start gap-4 p-5`} key={e.id}>
            <div className="min-w-0 flex-1">
              <strong className="text-base font-semibold">
                <a
                  className="focus-ring rounded-sm hover:text-accent"
                  href={`/?edition=${e.id}`}
                >
                  {e.name}
                </a>
              </strong>
              <EditionForm
                draft={{
                  id: e.id,
                  name: e.name,
                  section_ids: e.section_ids,
                  query: e.query ?? '',
                  tag: e.tag ?? '',
                }}
                sections={options}
              />
            </div>
            <RemoveEditionButton id={e.id} />
          </li>
        ))}
      </ul>
      <PageSection id="new-edition" title="New edition">
        <div className={`${CARD} p-5`}>
          <EditionForm draft={BLANK} sections={options} />
        </div>
      </PageSection>
    </div>
  );
}
