/**
 * The feeds the signed-in person follows.
 *
 *   POST /api/feeds {url} → 201 + Location (200 + Location when they
 *                           already follow it)
 */

import { NextResponse } from 'next/server';

import { feedResource, parseFeedInput } from '@/lib/api/feed-resource';
import { readJsonObject } from '@/lib/api/json';
import { problems } from '@/lib/api/problem';
import { requireSignedIn } from '@/lib/auth/guard';
import { addFeed, getFeedByUrl } from '@/lib/repository';
import { refreshFeed } from '@/lib/scraping';
import { getDatabase, getEnv, runInBackground } from '@/lib/util';
import { appOrigin } from '@/lib/util/origin';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/feeds`: follow a feed. Answers 201 with the new feed and its
 * `Location` (its first edition is fetched in the background), 200 with the
 * existing feed when they already follow that address, 400 for a body that is
 * not a valid feed, 401 when nobody is signed in, 403 for a request from
 * another site, or 415 for a body that is not JSON.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const caller = await requireSignedIn(request);
  if (!caller.ok) {
    return caller.response;
  }
  const body = await readJsonObject(request, 'The feed must be a JSON object.');
  if (!body.ok) {
    return body.response;
  }
  const input = parseFeedInput(body.value);
  if (!input.ok) {
    return problems.badRequest('The feed is not valid.', input.errors);
  }

  const db = getDatabase();
  const existing = await getFeedByUrl(db, caller.user.id, input.url);
  if (existing) {
    return NextResponse.json(feedResource(existing), {
      headers: {
        Location: `${appOrigin(request)}/api/feeds/${existing.id}`,
        'Cache-Control': 'private, no-cache',
      },
    });
  }
  const feed = await addFeed(db, caller.user.id, input.url);
  if (!feed) {
    return problems.badRequest('The feed could not be added.');
  }
  runInBackground(refreshFeed(db, getEnv(), feed).catch(() => undefined));
  return NextResponse.json(feedResource(feed), {
    status: 201,
    headers: { Location: `${appOrigin(request)}/api/feeds/${feed.id}` },
  });
}
