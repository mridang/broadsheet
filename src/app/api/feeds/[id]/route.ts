/**
 * One feed the signed-in person follows.
 *
 *   GET    /api/feeds/:id → 200
 *   DELETE /api/feeds/:id → 204
 */

import { NextResponse } from 'next/server';

import { feedResource, parseFeedId } from '@/lib/api/feed-resource';
import { problems } from '@/lib/api/problem';
import type { IdContext } from '@/lib/api/route-context';
import { requireSignedIn } from '@/lib/auth/guard';
import { getFeed, removeFeed } from '@/lib/repository';
import { getDatabase } from '@/lib/util';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/feeds/:id`: the feed. Answers 200, 404 when the person follows no
 * such feed (another person's feed is the same 404), 401 or 403 as for any
 * request that needs a signed-in same-site caller.
 */
export async function GET(
  request: Request,
  { params }: IdContext,
): Promise<NextResponse> {
  const caller = await requireSignedIn(request);
  if (!caller.ok) {
    return caller.response;
  }
  const id = parseFeedId((await params).id);
  const feed =
    id === undefined
      ? undefined
      : await getFeed(getDatabase(), caller.user.id, id);
  return feed
    ? NextResponse.json(feedResource(feed), {
        headers: { 'Cache-Control': 'private, no-cache' },
      })
    : problems.notFound('feed');
}

/**
 * `DELETE /api/feeds/:id`: stop following the feed. Answers 204, 404 when there
 * is no such feed, 401 or 403 as above.
 */
export async function DELETE(
  request: Request,
  { params }: IdContext,
): Promise<NextResponse> {
  const caller = await requireSignedIn(request);
  if (!caller.ok) {
    return caller.response;
  }
  const id = parseFeedId((await params).id);
  const removed =
    id !== undefined && (await removeFeed(getDatabase(), caller.user.id, id));
  return removed
    ? new NextResponse(null, { status: 204 })
    : problems.notFound('feed');
}
