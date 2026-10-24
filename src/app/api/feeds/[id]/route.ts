/**
 * One feed the signed-in person follows. Nothing reads it back on its own: the
 * page lists feeds on the server, so only removing one is offered.
 *
 *   DELETE /api/feeds/:id → 204
 */

import { NextResponse } from 'next/server';

import { parseFeedId } from '@/domain/api/feed-resource';
import { problems } from '@/lib/rest-json/problem';
import type { IdContext } from '@/core/api/route-context';
import { requireSignedIn } from '@/core/auth/guard';
import { Repository } from '@/domain/repository';
import { getDatabase } from '@/core/runtime';

export const dynamic = 'force-dynamic';

/**
 * `DELETE /api/feeds/:id`: stop following the feed. Answers 204, 404 when there
 * is no such feed (or the id cannot name one, `refreshes` included), 401 when
 * nobody is signed in, or 403 for a request from another site.
 */
export async function DELETE(
  request: Request,
  { params }: IdContext,
): Promise<Response> {
  const caller = await requireSignedIn(request);
  if (!caller.ok) {
    return caller.response;
  }
  const id = parseFeedId((await params).id);
  const removed =
    id !== undefined &&
    (await new Repository(getDatabase()).removeFeed(caller.user.id, id));
  return removed
    ? new NextResponse(null, { status: 204 })
    : problems.notFound('feed');
}
