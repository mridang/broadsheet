import type { NextRequest } from 'next/server';

import { currentUser, db } from '@/lib/account';
import { removeFeed } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/feeds/[id]/delete'>,
): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.redirect(new URL('/login', request.url), 303);
  const { id } = await ctx.params;
  await removeFeed(db(), user.id, Number(id));
  return Response.redirect(new URL('/feeds', request.url), 303);
}
