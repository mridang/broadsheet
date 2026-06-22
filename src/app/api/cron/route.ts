import type { NextRequest } from 'next/server';

import { db, env } from '@/lib/account';
import { refreshAll } from '@/lib/scraping';
import { logError } from '@/lib/util';

export const dynamic = 'force-dynamic';

// Manual refresh nudge. The recurring run is the scheduled() cron in
// src/worker.ts; this endpoint is for testing and ad-hoc refreshes. When
// CRON_SECRET is set, callers must present it as a bearer token.
async function handle(request: NextRequest): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    logError({ event: 'cron.unauthorized' });
    return new Response('Unauthorized', { status: 401 });
  }
  const result = await refreshAll(db(), env());
  return Response.json({ refreshed: true, ...result });
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request);
}
