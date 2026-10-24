/**
 * The refreshes of the signed-in person's feeds.
 *
 *   POST /api/feeds/refreshes → 200 {feeds, refreshed, failed}
 *
 * A refresh is not stored, so there is nothing to fetch afterwards: the result
 * is in the response, which is why it answers 200 and not 201.
 */

import { NextResponse } from 'next/server';

import { requireSignedIn } from '@/core/auth/guard';
import { listFeeds } from '@/domain/repository';
import { refreshFeed } from '@/domain/scraping/index';
import { getDatabase, getEnv } from '@/core/runtime';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/feeds/refreshes`: fetch every feed the person follows again now.
 * Answers 200 with how many feeds there were and how many were refreshed or
 * failed, 401 when nobody is signed in, or 403 for a request from another site.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const caller = await requireSignedIn(request);
  if (!caller.ok) {
    return caller.response;
  }
  const db = getDatabase();
  const env = getEnv();
  const feeds = await listFeeds(db, caller.user.id);
  const outcomes = await Promise.all(
    feeds.map((feed) =>
      refreshFeed(db, env, feed).then(
        (result) => result.ok,
        () => false,
      ),
    ),
  );
  const refreshed = outcomes.filter(Boolean).length;
  return NextResponse.json(
    { feeds: feeds.length, refreshed, failed: feeds.length - refreshed },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
