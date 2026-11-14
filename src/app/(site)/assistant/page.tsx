import type { Metadata } from 'next';
import { ButtonLink, TextLink } from '@/components/ui/button';
import { List, ListItem } from '@/components/ui/card';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { AssistantChat } from '@/app/(site)/assistant/_components/assistant-chat';
import { DeleteConversationButton } from '@/app/(site)/assistant/_components/delete-conversation-button';
import { conversationResource } from '@/domain/api/conversation-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import { starterQuestions } from '@/domain/assistant';
import { getDatabase } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { PageHeader, PageSection } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** The assistant answers from the reader's own archive: never indexed. */
export const metadata: Metadata = {
  title: 'Assistant',
  robots: { index: false, follow: false },
};

/**
 * Ask questions of everything in the reader's feeds, saves and reads; each
 * answer links to the stories it drew on. Past conversations are listed to
 * reopen (`?c={id}`) or delete; a new one starts with suggested questions.
 */
export default async function AssistantPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ c?: string }>;
}>): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const repo = new Repository(getDatabase());
  const query = await searchParams;
  const id = parseFeedId(String(query.c ?? ''));
  const open =
    id === undefined ? undefined : await repo.getConversation(user.id, id);
  const turns = open ? await repo.listMessages(open.id) : [];
  const current = open
    ? conversationResource(
        open,
        turns,
        await repo.articleTitles(turns.flatMap((t) => t.citations)),
      )
    : undefined;
  const [past, summary] = await Promise.all([
    repo.listConversations(user.id),
    repo.archiveSummary(user.id),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Ask your archive"
        description="Answers come from the stories in your feeds, saves and reads, with links to the ones they draw on."
      />
      <div className="mt-8">
        {current ? (
          <div className="mb-4">
            <ButtonLink variant="outline" size="sm" href="/assistant">
              New conversation
            </ButtonLink>
          </div>
        ) : null}
        <AssistantChat
          key={current?.id ?? 'new'}
          conversationId={current?.id}
          initialTurns={current?.messages ?? []}
          suggestions={current ? [] : starterQuestions(summary)}
        />
      </div>
      {past.length > 0 ? (
        <PageSection id="past-conversations" title="Past conversations">
          <List>
            {past.map((c) => (
              <ListItem
                key={c.id}
                title={
                  <TextLink href={`/assistant?c=${c.id}`}>
                    {c.title || 'Untitled conversation'}
                  </TextLink>
                }
                actions={<DeleteConversationButton id={String(c.id)} />}
              />
            ))}
          </List>
        </PageSection>
      ) : null}
    </div>
  );
}
