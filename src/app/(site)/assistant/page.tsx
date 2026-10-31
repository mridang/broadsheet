import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { AssistantChat } from '@/app/(site)/assistant/_components/assistant-chat';
import { getCurrentUser } from '@/lib/core/auth';

export const dynamic = 'force-dynamic';

/** The assistant answers from the reader's own archive: never indexed. */
export const metadata: Metadata = {
  title: 'Assistant',
  robots: { index: false, follow: false },
};

/**
 * Ask questions of everything in the reader's feeds, saves and reads; each
 * answer links to the stories it drew on.
 */
export default async function AssistantPage(): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div className="panel">
      <h2>Ask your archive</h2>
      <p className="muted">
        Answers come from the stories in your feeds, saves and reads, with links
        to the ones they draw on.
      </p>
      <AssistantChat />
    </div>
  );
}
