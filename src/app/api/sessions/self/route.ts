/**
 * The caller's own session. Deleting it signs them out; it is idempotent, so
 * signing out twice (or when already signed out) is fine.
 *
 *   DELETE /api/sessions/self → 204
 */

import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/app';
import { crossSiteRefusal } from '@/lib/auth/guard';

/**
 * `DELETE /api/sessions/self`: sign out by clearing the session cookie. Answers
 * 204, or 403 when the request came from another site (so a stranger's page
 * cannot sign people out).
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const refused = crossSiteRefusal(request);
  if (refused) {
    return refused;
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
