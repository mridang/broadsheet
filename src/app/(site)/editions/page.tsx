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
    <div className="panel">
      <h2>Your editions</h2>
      <p className="muted">
        Each edition is its own paper, laid out every day from the stories its
        rules pick.
      </p>
      {editions.map((e) => (
        <div className="feedrow" key={e.id}>
          <div>
            <strong>
              <a href={`/?edition=${e.id}`}>{e.name}</a>
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
        </div>
      ))}
      <h3>New edition</h3>
      <EditionForm draft={BLANK} sections={options} />
    </div>
  );
}
