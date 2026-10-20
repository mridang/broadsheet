import type { NextRequest } from 'next/server';

import { currentUser } from '@/lib/account';
import { getDatabase, getEnv } from '@/lib/util';
import { listFeeds } from '@/lib/repository';
import { refreshFeed } from '@/lib/scraping';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.redirect(new URL('/login', request.url), 303);
  const feeds = await listFeeds(getDatabase(), user.id);
  await Promise.all(
    feeds.map((f) =>
      refreshFeed(getDatabase(), getEnv(), f).catch(() => undefined),
    ),
  );
  return Response.redirect(new URL('/feeds', request.url), 303);
}
