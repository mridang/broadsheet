import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { OutboundRepository } from '@/domain/outbound';
import { Repository } from '@/domain/repository';

import { AddTokenForm } from '@/app/(site)/settings/_components/add-token-form';
import { AddWebhookForm } from '@/app/(site)/settings/_components/add-webhook-form';
import { PushSettings } from '@/app/(site)/settings/_components/push-settings';
import { RemoveWebhookButton } from '@/app/(site)/settings/_components/remove-webhook-button';
import { RevokeTokenButton } from '@/app/(site)/settings/_components/revoke-token-button';

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
  const [pushes, hooks, tokens, sections] = await Promise.all([
    outbound.pushSubscriptions(user.id),
    outbound.listWebhooks(user.id),
    outbound.listFeedTokens(user.id),
    new Repository(db).listSections(user.id),
  ]);
  const names = new Map(sections.map((s) => [s.id, s.name]));

  return (
    <div className="panel">
      <h2>Notifications</h2>
      <p className="muted">
        A notification on this device when the day’s paper is ready.
      </p>
      <PushSettings
        subscriptions={pushes.map((p) => ({ id: p.id, endpoint: p.endpoint }))}
      />
      <h2>Webhooks</h2>
      <p className="muted">
        A signed POST to your own address whenever you save or like a story.
      </p>
      <AddWebhookForm />
      {hooks.map((h) => (
        <div className="feedrow" key={h.id}>
          <div>
            <strong>{h.url}</strong>
            <div className="u">{h.events.join(', ')}</div>
          </div>
          <RemoveWebhookButton id={h.id} />
        </div>
      ))}
      <h2>Private feeds</h2>
      <p className="muted">
        Atom feeds of your saves, a section or the whole edition, for a feed
        reader.
      </p>
      <AddTokenForm
        sections={sections.map((s) => ({ id: s.id, name: s.name }))}
      />
      {tokens.map((t) => (
        <div className="feedrow" key={t.id}>
          <strong>{scopeText(t, names)}</strong>
          <RevokeTokenButton id={t.id} />
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
