import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { NextRequest } from 'next/server';

import { currentUser, db, env } from '@/lib/account';
import { addFeed } from '@/lib/repository';
import { refreshFeed } from '@/lib/scraping';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.redirect(new URL('/login', request.url), 303);

  const form = await request.formData();
  const url = String(form.get('url') ?? '').trim();
  if (url) {
    const feed = await addFeed(db(), user.id, url);
    if (feed) {
      getCloudflareContext().ctx.waitUntil(
        refreshFeed(db(), env(), feed).catch(() => undefined),
      );
    }
  }
  return Response.redirect(new URL('/feeds', request.url), 303);
}
