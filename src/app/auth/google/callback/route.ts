import type { NextRequest } from 'next/server';

import {
  clearOAuthCookie,
  db,
  env,
  readOAuthState,
  seedDefaults,
  sessionCookie,
} from '@/lib/account';
import { exchange } from '@/lib/auth';
import { upsertUser } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const want = await readOAuthState();
  if (!want || url.searchParams.get('state') !== want) {
    return new Response('bad state', { status: 400 });
  }
  const code = url.searchParams.get('code');
  if (!code) return new Response('missing code', { status: 400 });

  const e = env();
  const base = e.BASE_URL ?? url.origin;
  const profile = await exchange(e, code, base + '/auth/google/callback');
  const user = await upsertUser(db(), profile);
  await seedDefaults(user.id);

  const headers = new Headers({ Location: '/feeds' });
  headers.append('Set-Cookie', await sessionCookie(user.id));
  headers.append('Set-Cookie', clearOAuthCookie());
  return new Response(null, { status: 302, headers });
}
