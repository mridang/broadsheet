import type { NextRequest } from 'next/server';

import { env, oauthStateCookie } from '@/lib/account';
import { authUrl, oauthConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const e = env();
  if (!oauthConfigured(e))
    return Response.redirect(new URL('/login', request.url), 302);

  const state = crypto.randomUUID().replace(/-/g, '');
  const base = e.BASE_URL ?? new URL(request.url).origin;
  const headers = new Headers({
    Location: authUrl(e, base + '/auth/google/callback', state),
  });
  headers.append('Set-Cookie', await oauthStateCookie(state));
  return new Response(null, { status: 302, headers });
}
