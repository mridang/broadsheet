/**
 * Start the Google sign-in flow. Signing in asks Google for identity only.
 * Generates a one-time `state`, stores it in a short-lived httpOnly cookie for
 * the callback to validate (CSRF protection), and redirects the browser to
 * Google's consent screen. Refuses, saying what is missing, when the server is
 * not set up for signing in: it never falls back to a made-up secret.
 */

import { NextRequest, NextResponse } from 'next/server';

import { problem } from '@/lib/rest-json/problem';
import { startFlowCookies } from '@/core/auth/flow-cookies';
import { GoogleOAuthClient, SIGN_IN_SCOPES } from '@/lib/google/auth';
import { SIGN_IN_PURPOSE, newState } from '@/lib/web-security/oauth-state';
import { safeReturnPath } from '@/lib/web-security/return-to';
import { missingSignInSettings } from '@/domain/auth/sign-in';
import { getEnv } from '@/core/runtime';
import { logError } from '@/utils/logging';
import { appOrigin } from '@/core/origin';

/**
 * `GET /auth/login`: send the browser to Google to sign in. Open to
 * everyone. Answers a redirect to Google's consent screen, with the one-time
 * `state` and the safe `?returnTo=` path (if any) kept in short-lived cookies,
 * or 503 naming the settings that are missing.
 */
export function GET(request: NextRequest): Response {
  const env = getEnv();
  const missing = missingSignInSettings(env);
  if (missing.length > 0) {
    logError({ event: 'auth.login.not_configured', missing });
    return problem(
      503,
      '/problems/not-configured',
      'Sign-in is not set up',
      `Sign-in is not set up on this server. Missing: ${missing.join(', ')}.`,
    );
  }
  const origin = appOrigin(request);
  const state = newState(SIGN_IN_PURPOSE);
  const client = new GoogleOAuthClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${origin}/auth/callback`,
  });
  const response = NextResponse.redirect(
    client.authUrl({ state, scopes: SIGN_IN_SCOPES }),
  );
  // Remember where to land afterwards (e.g. back on an assistant's approval
  // screen), but only if it is a path on this site.
  startFlowCookies(response, {
    state,
    returnTo: safeReturnPath(request.nextUrl.searchParams.get('returnTo')),
    secure: origin.startsWith('https'),
  });
  return response;
}
