/**
 * The WebSub callback of a source, where its hub verifies a subscription and
 * pushes new content. It is a webhook for a hub to call, not part of the REST
 * contract, so it lives outside `/api` and answers plain text.
 *
 * GET  /webhooks/sources/{id}?hub.mode&hub.topic&hub.challenge → 200 the challenge, 404 when the source does not want it
 *   POST /webhooks/sources/{id} (the feed, X-Hub-Signature)       → 202, 404 for a source with no subscription.
 *
 * The behaviour lives in `domain/websub` and `domain/scraping`.
 */

import { getDatabase } from '@/domain/db/client';
import { acceptPush } from '@/domain/scraping/index';
import { verifyIntent } from '@/domain/websub';
import { getEnv } from '@/lib/core/runtime';

export const dynamic = 'force-dynamic';

/** The largest push taken, in bytes. */
const MAX_PUSH_BYTES = 4 * 1024 * 1024;

interface Context {
  readonly params: Promise<{ id: string }>;
}

const text = (body: string, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

/** The source id in the path, or undefined when it is not one. */
async function sourceId({ params }: Context): Promise<number | undefined> {
  const { id } = await params;
  return /^[1-9]\d{0,15}$/.test(id) ? Number(id) : undefined;
}

export async function GET(request: Request, context: Context) {
  const id = await sourceId(context);
  const challenge =
    id === undefined
      ? undefined
      : await verifyIntent(
          getDatabase(),
          id,
          new URL(request.url).searchParams,
        );
  return challenge === undefined
    ? text('Not found.', 404)
    : text(challenge, 200);
}

export async function POST(request: Request, context: Context) {
  const id = await sourceId(context);
  if (id === undefined) return text('Not found.', 404);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_PUSH_BYTES) return text('Too large.', 413);
  const result = await acceptPush(
    getDatabase(),
    getEnv(),
    id,
    body,
    request.headers.get('x-hub-signature'),
  );
  // A push whose signature does not match is acknowledged and ignored.
  return result === 'unknown'
    ? text('Not found.', 404)
    : new Response(null, { status: 202 });
}
