/**
 * @packageDocumentation
 *
 * Finishing a Google sign-in: record the person, run the app's own hook for a
 * new sign-in, issue the session cookie and send them on. Also what has to be
 * configured before any of it can work; without it sign-in is refused up front
 * rather than half working.
 */

import type { NextRequest, NextResponse } from 'next/server';

import { LANDING_PATH } from './app';
import { finishFlow } from './flow-cookies';
import type { GoogleUser, TokenResponse } from './google-oauth';
import { afterSignIn } from './hooks';
import { requireSessionSecret } from './session';
import { setSessionCookie } from './session-cookie';
import { upsertGoogleUser } from './store';

/** Where a round trip stands: who is asking, and where it came from. */
export interface FlowContext {
  readonly request: NextRequest;
  readonly env: CloudflareEnv;
  /** This site's public origin. */
  readonly origin: string;
  /** Where to land afterwards, from the cookie set when the trip began. */
  readonly returnTo: string | undefined;
}

/** How an ask other than signing in finishes, and where it sends people when it does not. */
export interface OtherFlow {
  /** Where to send someone whose round trip failed (`error`) or who closed the window or pressed Cancel (`denied`). */
  readonly failurePath: (kind: 'error' | 'denied') => string;
  /** Finish the round trip for a code that has been exchanged. */
  readonly complete: (
    context: FlowContext,
    info: GoogleUser,
    tokens: TokenResponse,
  ) => Promise<NextResponse>;
}

/**
 * The names of the settings signing in needs that are not set, in the order
 * to report them. Empty when sign-in can go ahead. Only names are ever
 * reported, never values.
 */
export function missingSignInSettings(env: CloudflareEnv): string[] {
  const required: ReadonlyArray<readonly [string, string | undefined]> = [
    ['GOOGLE_OAUTH_CLIENT_ID', env.GOOGLE_OAUTH_CLIENT_ID],
    ['GOOGLE_OAUTH_CLIENT_SECRET', env.GOOGLE_OAUTH_CLIENT_SECRET],
    ['SESSION_SECRET', env.SESSION_SECRET],
  ];
  return required.filter(([, value]) => !value).map(([name]) => name);
}

/** Finish a sign-in: record the person, issue their session and send them on. */
export async function completeSignIn(
  { env, origin, returnTo }: FlowContext,
  info: GoogleUser,
): Promise<NextResponse> {
  if (!info.email) {
    // Signing in asked for the email scope, so Google not sharing one is a
    // failed sign-in, not an account without an address.
    throw new Error('Google did not share an email address');
  }
  const secret = requireSessionSecret(env.SESSION_SECRET);
  const user = await upsertGoogleUser({
    sub: info.sub,
    email: info.email,
    name: info.name,
    picture: info.picture,
  });
  await afterSignIn(user);
  const response = finishFlow(origin, returnTo ?? LANDING_PATH);
  await setSessionCookie(response, user, {
    secret,
    secure: origin.startsWith('https'),
  });
  return response;
}
