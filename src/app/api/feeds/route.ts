import type { NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { getDatabase, getEnv, runInBackground } from '@/lib/util';
import { addFeed } from '@/lib/repository';
import { refreshFeed } from '@/lib/scraping';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL('/login', request.url), 303);

  const form = await request.formData();
  const url = String(form.get('url') ?? '').trim();
  if (url) {
    const feed = await addFeed(getDatabase(), user.id, url);
    if (feed) {
      runInBackground(
        refreshFeed(getDatabase(), getEnv(), feed).catch(() => undefined),
      );
    }
  }
  return Response.redirect(new URL('/feeds', request.url), 303);
}
