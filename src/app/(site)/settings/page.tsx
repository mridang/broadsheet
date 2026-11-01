import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { NotificationRepository } from '@/domain/notifications';
import { OutboundRepository } from '@/domain/outbound';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';

import { AddTokenForm } from '@/app/(site)/settings/_components/add-token-form';
import { AddWebhookForm } from '@/app/(site)/settings/_components/add-webhook-form';
import { AddRuleForm } from '@/app/(site)/settings/_components/add-rule-form';
import { RemoveRuleButton } from '@/app/(site)/settings/_components/remove-rule-button';
import { FeedNotificationForm } from '@/app/(site)/settings/_components/feed-notification-form';
import { PushSettings } from '@/app/(site)/settings/_components/push-settings';
import { RemoveWebhookButton } from '@/app/(site)/settings/_components/remove-webhook-button';
import { RevokeTokenButton } from '@/app/(site)/settings/_components/revoke-token-button';
import { CARD } from '@/components/ui/field';
import { PageHeader, PageSection } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** The tab title of the settings page. */
export const metadata: Metadata = { title: 'Settings' };

/** What a feed token shows, in words. */
function scopeText(
  token: { scope: string; tag: string | null; section_id: number | null },
  sections: ReadonlyMap<number, string>,
): string {
  if (token.scope === 'edition') return 'The whole edition';
  if (token.scope === 'section') {
    return `Section: ${sections.get(token.section_id ?? 0) ?? 'removed'}`;
  }
  return token.tag ? `Saved stories tagged “${token.tag}”` : 'Saved stories';
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = getDatabase();
  const outbound = new OutboundRepository(db);
  const repo = new Repository(db);
  const [pushes, hooks, tokens, sections, feeds, notifying, rules] =
    await Promise.all([
      outbound.pushSubscriptions(user.id),
      outbound.listWebhooks(user.id),
      outbound.listFeedTokens(user.id),
      repo.listSections(user.id),
      repo.listFeeds(user.id),
      new NotificationRepository(db).feedNotifications(user.id),
      new NotificationRepository(db).rules(user.id),
    ]);
  const settings = new Map(notifying.map((n) => [n.feed_id, n]));
  const names = new Map(sections.map((s) => [s.id, s.name]));

  const list = `${CARD} mt-4 divide-y divide-line`;
  const row = 'flex items-center justify-between gap-4 px-5 py-3';
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Notifications, webhooks and private feeds."
      />
      <PageSection
        id="notifications"
        title="Notifications"
        description="A notification on this device when the day’s paper is ready."
      >
        <PushSettings
          subscriptions={pushes.map((p) => ({
            id: p.id,
            endpoint: p.endpoint,
          }))}
        />
      </PageSection>
      <PageSection
        id="new-stories"
        title="New stories"
        description="Be told about new stories in a feed: by push to the browsers above, by email, or as a webhook. At most three stories a feed each day."
      >
        {feeds.length ? (
          <ul className={`${CARD} divide-y divide-line`}>
            {feeds.map((f) => (
              <li key={f.id} className="px-5 py-3">
                <FeedNotificationForm
                  feedId={f.id}
                  title={f.title || hostOf(f.url)}
                  filter={settings.get(f.id)?.filter ?? 'unread'}
                  channels={settings.get(f.id)?.channels ?? []}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>
      <PageSection
        id="story-rules"
        title="Story rules"
        description="Be told about any new story whose title, text, address, author or tag matches, in one feed, one section or every feed."
      >
        <AddRuleForm
          feeds={feeds.map((f) => ({
            id: f.id,
            title: f.title || hostOf(f.url),
          }))}
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
        />
        {rules.length ? (
          <ul className={list}>
            {rules.map((rule) => (
              <li className={row} key={rule.id}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold">
                    {rule.kind} {rule.is_regex ? 'matches' : 'has'} “
                    {rule.value}”
                  </strong>
                  <div className="text-xs text-subtle">
                    {rule.channels.join(', ')}
                  </div>
                </div>
                <RemoveRuleButton id={rule.id} />
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>
      <PageSection
        id="webhooks"
        title="Webhooks"
        description="A signed POST to your own address whenever you save or like a story, or a notifying feed has a new one (IFTTT’s Webhooks service can take it)."
      >
        <AddWebhookForm />
        {hooks.length ? (
          <ul className={list}>
            {hooks.map((h) => (
              <li className={row} key={h.id}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold">
                    {h.url}
                  </strong>
                  <div className="text-xs text-subtle">
                    {h.events.join(', ')}
                  </div>
                </div>
                <RemoveWebhookButton id={h.id} />
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>
      <PageSection
        id="private-feeds"
        title="Private feeds"
        description="Atom feeds of your saves, a section or the whole edition, for a feed reader."
      >
        <AddTokenForm
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
        />
        {tokens.length ? (
          <ul className={list}>
            {tokens.map((t) => (
              <li className={row} key={t.id}>
                <strong className="text-sm font-semibold">
                  {scopeText(t, names)}
                </strong>
                <RevokeTokenButton id={t.id} />
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>
    </div>
  );
}
