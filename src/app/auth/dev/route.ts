import type { NextRequest } from 'next/server';

import { db, devLoginOn, seedDefaults, sessionCookie } from '@/lib/account';
import { upsertUser } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  if (!devLoginOn()) return new Response('dev login disabled', { status: 403 });

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  if (!email) return Response.redirect(new URL('/login', request.url), 303);

  const user = await upsertUser(db(), {
    sub: 'dev:' + email,
    email,
    name: email.split('@')[0] ?? email,
    picture: '',
  });
  await seedDefaults(user.id);

  const headers = new Headers({ Location: '/feeds' });
  headers.append('Set-Cookie', await sessionCookie(user.id));
  return new Response(null, { status: 303, headers });
}
