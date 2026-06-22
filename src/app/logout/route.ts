import type { NextRequest } from 'next/server';

import { clearSessionCookie } from '@/lib/account';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): Response {
  const headers = new Headers({
    Location: new URL('/', request.url).toString(),
  });
  headers.append('Set-Cookie', clearSessionCookie());
  return new Response(null, { status: 302, headers });
}
