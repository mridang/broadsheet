import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/client';
import { NotificationRepository } from '@/domain/notifications';
import { OutboundRepository } from '@/domain/outbound';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';

import { AddTokenForm } from '@/app/(site)/settings/_components/add-token-form';
import { AddWebhookForm } from '@/app/(site)/settings/_components/add-webhook-form';
import { AddRuleForm } from '@/app/(site)/settings/_components/add-rule-form';
import { RemoveRuleButton } from '@/app/(site)/settings/_components/remove-rule-button';
import { FeedNotificationForm } from '@/app/(site)/settings/_components/feed-notification-form';
import { ReadingPreferences } from '@/app/(site)/settings/_components/reading-preferences';
import { PushSettings } from '@/app/(site)/settings/_components/push-settings';
import { RemoveWebhookButton } from '@/app/(site)/settings/_components/remove-webhook-button';
import { RevokeTokenButton } from '@/app/(site)/settings/_components/revoke-token-button';
import { List, ListItem } from '@/components/ui/card';
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
  if (token.scope === 'highlights') return 'Highlights';
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
  const [pushes, hooks, tokens, sections, feeds, notifying, rules, prefs] =
    await Promise.all([
      outbound.pushSubscriptions(user.id),
      outbound.listWebhooks(user.id),
      outbound.listFeedTokens(user.id),
      repo.listSections(user.id),
      repo.listFeeds(user.id),
      new NotificationRepository(db).feedNotifications(user.id),
      new NotificationRepository(db).rules(user.id),
      repo.getPreferences(user.id),
    ]);
  const settings = new Map(notifying.map((n) => [n.feed_id, n]));
  const names = new Map(sections.map((s) => [s.id, s.name]));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Reading, notifications, webhooks and private feeds."
      />
      <PageSection
        id="reading"
        title="Reading"
        description="How much of the paper your training lets through, and when stories count as read."
      >
        <ReadingPreferences
          intelligence={prefs.intelligence}
          markReadOnOpen={prefs.mark_read_on_open}
          autoMarkReadDays={prefs.auto_mark_read_days}
          markReadOnScroll={prefs.mark_read_on_scroll}
        />
      </PageSection>
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
        {feeds.length > 0 ? (
          <List label="Feeds">
            {feeds.map((f) => (
              <li key={f.id} className="px-4 py-3.5 sm:px-5">
                <FeedNotificationForm
                  feedId={f.id}
                  title={f.title || hostOf(f.url)}
                  filter={settings.get(f.id)?.filter ?? 'unread'}
                  channels={settings.get(f.id)?.channels ?? []}
                />
              </li>
            ))}
          </List>
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
        {rules.length > 0 ? (
          <List label="Story rules" className="mt-4">
            {rules.map((rule) => (
              <ListItem
                key={rule.id}
                title={`${rule.kind} ${rule.is_regex ? 'matches' : 'has'} “${rule.value}”`}
                detail={rule.channels.join(', ')}
                actions={<RemoveRuleButton id={rule.id} />}
              />
            ))}
          </List>
        ) : null}
      </PageSection>
      <PageSection
        id="webhooks"
        title="Webhooks"
        description="A signed POST to your own address whenever you save or like a story, or a notifying feed has a new one (IFTTT’s Webhooks service can take it)."
      >
        <AddWebhookForm />
        {hooks.length > 0 ? (
          <List label="Webhooks" className="mt-4">
            {hooks.map((h) => (
              <ListItem
                key={h.id}
                title={h.url}
                detail={h.events.join(', ')}
                actions={<RemoveWebhookButton id={h.id} />}
              />
            ))}
          </List>
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
        {tokens.length > 0 ? (
          <List label="Private feeds" className="mt-4">
            {tokens.map((t) => (
              <ListItem
                key={t.id}
                title={scopeText(t, names)}
                actions={<RevokeTokenButton id={t.id} />}
              />
            ))}
          </List>
        ) : null}
      </PageSection>
    </div>
  );
}
