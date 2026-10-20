/**
 * Google's way back into the app.
 *
 * Signing in: validates the `state`, exchanges the code, loads the identity,
 * records the user, issues the session cookie and sends them on (to the app's
 * landing page unless they came from somewhere specific).
 *
 * An app can have other asks that come back the same way (see `EXTRA_PURPOSES`
 * in `app.ts`); the `state` says which one this was, and the app's own flow
 * (see `hooks.ts`) finishes it.
 *
 * Any failure sends them back with a fixed flag rather than leaking details.
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  RETURN_COOKIE,
  SIGN_IN_FAILED_PATH,
  STATE_COOKIE,
} from '@/lib/auth/app';
import { finishFlow } from '@/lib/auth/flow-cookies';
import { exchangeCode, getUserInfo } from '@/lib/auth/google-oauth';
import { OTHER_FLOWS } from '@/lib/auth/hooks';
import { SIGN_IN_PURPOSE, checkState } from '@/lib/auth/oauth-state';
import { safeReturnPath } from '@/lib/auth/return-to';
import {
  completeSignIn,
  missingSignInSettings,
  type FlowContext,
} from '@/lib/auth/sign-in';
import { getEnv, logError, logWarn } from '@/lib/util';
import { appOrigin } from '@/lib/util/origin';

/** Where to send someone whose round trip failed, by what it was for. */
function failurePath(purpose: string, kind: 'error' | 'denied'): string {
  return purpose === SIGN_IN_PURPOSE
    ? SIGN_IN_FAILED_PATH
    : (OTHER_FLOWS[purpose]?.failurePath(kind) ?? SIGN_IN_FAILED_PATH);
}

/**
 * `GET /api/auth/callback`: where Google sends the browser back after consent.
 * Open to everyone, but only a request whose `state` matches the cookie set
 * when the trip began is acted on. Always answers a redirect: on to the app on
 * success, or back with a fixed flag on any failure.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  const origin = appOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const oauthError = url.searchParams.get('error');

  // Validate the round-trip before trusting the code.
  const checked = checkState(state, expectedState);
  if (!checked.ok) {
    logError({
      event: 'auth.callback.state_check_failed',
      hasState: Boolean(state),
      hasExpected: Boolean(expectedState),
      match: state === expectedState,
      oauthError,
    });
    // Leave the cookies alone: a stray or forged request must not be able to
    // wipe the state of a sign-in that is genuinely in flight. The label in the
    // value is only used to pick the wording, never trusted.
    return NextResponse.redirect(
      `${origin}${failurePath(checked.claimed ?? SIGN_IN_PURPOSE, 'error')}`,
    );
  }
  const { purpose } = checked;
  // Closed the Google window or pressed Cancel.
  if (!code) {
    logWarn({ event: 'auth.callback.no_code', purpose, oauthError });
    return finishFlow(origin, failurePath(purpose, 'denied'));
  }
  // Without these nothing can be signed or exchanged: stop before spending the code.
  const missing = missingSignInSettings(env);
  if (missing.length > 0) {
    logError({ event: 'auth.callback.not_configured', missing });
    return finishFlow(origin, failurePath(purpose, 'error'));
  }

  const context: FlowContext = {
    request,
    env,
    origin,
    returnTo: safeReturnPath(request.cookies.get(RETURN_COOKIE)?.value),
  };
  try {
    const tokens = await exchangeCode({
      code,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: `${origin}/api/auth/callback`,
    });
    const info = await getUserInfo(tokens.access_token);
    if (purpose === SIGN_IN_PURPOSE) {
      return await completeSignIn(context, info);
    }
    const other = OTHER_FLOWS[purpose];
    if (!other) {
      throw new Error(`No flow is registered for "${purpose}"`);
    }
    return await other.complete(context, info, tokens);
  } catch (err) {
    logError({
      event: 'auth.callback.failed',
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return finishFlow(origin, failurePath(purpose, 'error'));
  }
}
