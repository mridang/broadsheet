/**
 * @packageDocumentation
 *
 * WebSub (PubSubHubbub), as NewsBlur's push feeds: a feed that names a hub is
 * subscribed to there, with a callback at `/webhooks/sources/{id}` and a
 * secret of its own, renewed before the hub's lease runs out; the hub's
 * verification of the intent is answered here. The pushes themselves are
 * taken as fetches in `domain/scraping`.
 */

import { eq } from 'drizzle-orm';

import { type Database } from '@/domain/db/client';
import { sources } from '@/domain/db/schema';
import type { Source } from '@/domain/repository';
import { LEASE_SECONDS, type WebSubLinks } from '@/lib/scraping';
import { SITE_URL } from '@/utils/site';

/** A lease this close to running out is renewed: a day. */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

/** Where a hub pushes a source's new content. */
export const callbackUrl = (sourceId: number): string =>
  `${SITE_URL}/webhooks/sources/${sourceId}`;

/** A SQLite UTC datetime as a time. */
const timeOf = (at: string): number => Date.parse(`${at.replace(' ', 'T')}Z`);

/**
 * Whether a source whose feed has these links should be subscribed at its hub
 * again: it names a hub, and the source is not subscribed to that hub for
 * that topic, or the hub never verified it, or the lease is nearly up.
 */
export function needsSubscription(
  source: Pick<Source, 'websub_hub' | 'websub_topic' | 'websub_expires_at'>,
  links: WebSubLinks,
  now: number = Date.now(),
): boolean {
  if (!links.hub || !links.self) return false;
  return (
    source.websub_hub !== links.hub ||
    source.websub_topic !== links.self ||
    !source.websub_expires_at ||
    timeOf(source.websub_expires_at) - now < RENEW_BEFORE_MS
  );
}

/** A fresh secret for a hub to sign its pushes with. */
function newSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Ask the hub to push the feed's topic to the source's callback, keeping the
 * hub, topic and a new secret on the source for its verification and pushes.
 * Whether the hub accepted the request (a 2xx); it verifies it on its own.
 */
export async function subscribeToHub(
  db: Database,
  sourceId: number,
  links: Required<WebSubLinks>,
): Promise<boolean> {
  const secret = newSecret();
  await db
    .update(sources)
    .set({
      websub_hub: links.hub,
      websub_topic: links.self,
      websub_secret: secret,
    })
    .where(eq(sources.id, sourceId));
  const response = await fetch(links.hub, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.topic': links.self,
      'hub.callback': callbackUrl(sourceId),
      'hub.secret': secret,
      'hub.lease_seconds': String(LEASE_SECONDS),
      'hub.verify': 'async',
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

/**
 * Answer a hub's verification of intent for a source: the challenge to echo
 * when the source wants what the hub says (a subscription to its topic, whose
 * lease is then kept, or an unsubscription from a topic it no longer
 * follows), else undefined. A `denied` notice forgets the subscription.
 */
export async function verifyIntent(
  db: Database,
  sourceId: number,
  query: URLSearchParams,
  now: number = Date.now(),
): Promise<string | undefined> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
  });
  if (!source) return undefined;
  const mode = query.get('hub.mode');
  const topic = query.get('hub.topic');
  const challenge = query.get('hub.challenge');
  const subscribed = !!topic && topic === source.websub_topic;
  if (mode === 'denied') {
    if (subscribed) await forget(db, sourceId);
    return undefined;
  }
  if (!challenge) return undefined;
  if (mode === 'unsubscribe') return subscribed ? undefined : challenge;
  if (mode !== 'subscribe' || !subscribed) return undefined;
  const lease = Number(query.get('hub.lease_seconds'));
  const seconds = Number.isFinite(lease) && lease > 0 ? lease : LEASE_SECONDS;
  await db
    .update(sources)
    .set({
      websub_expires_at: new Date(now + seconds * 1000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' '),
    })
    .where(eq(sources.id, sourceId));
  return challenge;
}

/** Forget a source's subscription at its hub. */
async function forget(db: Database, sourceId: number): Promise<void> {
  await db
    .update(sources)
    .set({
      websub_hub: null,
      websub_topic: null,
      websub_secret: null,
      websub_expires_at: null,
    })
    .where(eq(sources.id, sourceId));
}
