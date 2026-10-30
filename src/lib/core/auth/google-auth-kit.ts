/**
 * @packageDocumentation
 *
 * The framework-tier kit that composes the pure OAuth and session libraries
 * with the app's own user store and settings into the two route handlers a
 * Google sign-in needs, plus the current-user lookup. Signing in genuinely
 * needs the framework (cookies, redirects), so it is not one pure library: this
 * kit is where {@link GoogleOAuthClient}, the state and return-to helpers, the
 * flow cookies and the app's `completeSignIn` meet.
 *
 * An app builds one kit with its configuration and mounts the handlers:
 *
 * ```ts
 * // src/app/auth/login/route.ts
 * export const GET = authKit.loginHandler();
 * ```
 */

import { NextResponse, type NextRequest } from 'next/server';

import { GoogleOAuthClient } from '@/lib/google/auth';
import type { GoogleUserResponse } from '@/lib/google/auth';
import { checkState, newState, safeReturnPath } from '@/lib/web-security';
import { finishFlow, startFlowCookies } from './flow-cookies';
import { getCurrentUser } from './current-user';
import type { FlowContext, OtherFlow } from '@/domain/auth/sign-in';
import type { User } from '@/domain/auth/store';
import { problem } from '@/lib/core/api';
import { setErrorContext } from '@/lib/core/observability/context';
import { getEnv } from '@/lib/core/runtime';
import { appOrigin } from '@/lib/core/origin';
import { logError, logWarn } from '@/utils/logging';

/**
 * Why a round trip failed, as shown next to an error in Workers Issues. A fixed
 * list of words: never text from Google, and never a code, state or token.
 */
type SignInFailure =
  | 'not_configured'
  | 'state_mismatch'
  | 'denied'
  | 'no_code'
  | 'token_exchange_failed'
  | 'userinfo_failed'
  | 'finish_failed';

/** The part of the round trip that was under way when it failed. */
type CallbackStep = 'exchange' | 'userinfo' | 'finish';

const FAILURE_AT: Readonly<Record<CallbackStep, SignInFailure>> = {
  exchange: 'token_exchange_failed',
  userinfo: 'userinfo_failed',
  finish: 'finish_failed',
};

/** Everything the kit needs from the app to run a Google sign-in. */
export interface GoogleAuthKitConfig {
  /** What signing in asks Google for. */
  readonly scopes: readonly string[];
  /** The cookie names for the one-time state and the return path. */
  readonly stateCookie: string;
  readonly returnCookie: string;
  /** Where to send someone whose sign-in failed. */
  readonly signInFailedPath: string;
  /** The label every app has, and the full set of valid purposes. */
  readonly signInPurpose: string;
  readonly purposes: readonly string[];
  /** The asks besides signing in, by purpose label. */
  readonly otherFlows: Readonly<Partial<Record<string, OtherFlow>>>;
  /** Finish a sign-in: record the person, issue their session, send them on. */
  readonly completeSignIn: (
    context: FlowContext,
    info: GoogleUserResponse,
  ) => Promise<NextResponse>;
  /** The settings signing in needs that are not set, in the order to report them. */
  readonly missingSignInSettings: (env: CloudflareEnv) => string[];
}

/**
 * Composes the sign-in flow from the app's {@link GoogleAuthKitConfig}. Built
 * once and used through {@link loginHandler}, {@link callbackHandler} and
 * {@link currentUser}.
 */
export class GoogleAuthKit {
  readonly #config: GoogleAuthKitConfig;

  constructor(config: GoogleAuthKitConfig) {
    this.#config = config;
  }

  /** Where to send someone whose round trip failed, by what it was for. */
  #failurePath(purpose: string, kind: 'error' | 'denied'): string {
    const { signInPurpose, signInFailedPath, otherFlows } = this.#config;
    return purpose === signInPurpose
      ? signInFailedPath
      : (otherFlows[purpose]?.failurePath(kind) ?? signInFailedPath);
  }

  #client(): GoogleOAuthClient {
    const env = getEnv();
    return new GoogleOAuthClient({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    });
  }

  /** `GET /auth/login`: send the browser to Google to sign in. */
  loginHandler(): (request: NextRequest) => Promise<Response> {
    return async (request) => {
      await setErrorContext({
        'auth.provider': 'google',
        'auth.flow': 'login',
        'auth.step': 'start',
      });
      const env = getEnv();
      const missing = this.#config.missingSignInSettings(env);
      if (missing.length > 0) {
        await setErrorContext({ 'auth.failure': 'not_configured' });
        logError({ event: 'auth.login.not_configured', missing });
        return problem(
          503,
          '/problems/not-configured',
          'Sign-in is not set up',
          `Sign-in is not set up on this server. Missing: ${missing.join(', ')}.`,
        );
      }
      const origin = appOrigin(request);
      const state = newState(this.#config.signInPurpose);
      const response = NextResponse.redirect(
        this.#client().authUrl({
          redirectUri: `${origin}/auth/callback`,
          state,
          scopes: this.#config.scopes,
        }),
      );
      startFlowCookies(response, {
        state,
        returnTo: safeReturnPath(request.nextUrl.searchParams.get('returnTo')),
        secure: origin.startsWith('https'),
      });
      return response;
    };
  }

  /** `GET /auth/callback`: where Google sends the browser back after consent. */
  callbackHandler(): (request: NextRequest) => Promise<NextResponse> {
    return async (request) => {
      const env = getEnv();
      const origin = appOrigin(request);
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const expectedState = request.cookies.get(
        this.#config.stateCookie,
      )?.value;
      const oauthError = url.searchParams.get('error');
      await setErrorContext({
        'auth.provider': 'google',
        'auth.flow': 'callback',
        'auth.step': 'state',
      });

      const checked = checkState(state, expectedState, this.#config.purposes);
      if (!checked.ok) {
        await setErrorContext({ 'auth.failure': 'state_mismatch' });
        logError({
          event: 'auth.callback.state_check_failed',
          hasState: Boolean(state),
          hasExpected: Boolean(expectedState),
          match: state === expectedState,
          oauthError,
        });
        return NextResponse.redirect(
          `${origin}${this.#failurePath(
            checked.claimed ?? this.#config.signInPurpose,
            'error',
          )}`,
        );
      }
      const { purpose } = checked;
      // Sign-in is the callback itself; the other asks are named by their purpose.
      await setErrorContext({
        'auth.flow':
          purpose === this.#config.signInPurpose ? 'callback' : purpose,
        'auth.step': 'consent',
      });
      if (!code) {
        await setErrorContext({
          'auth.failure': oauthError ? 'denied' : 'no_code',
        });
        logWarn({ event: 'auth.callback.no_code', purpose, oauthError });
        return finishFlow(origin, this.#failurePath(purpose, 'denied'));
      }
      const missing = this.#config.missingSignInSettings(env);
      if (missing.length > 0) {
        await setErrorContext({ 'auth.failure': 'not_configured' });
        logError({ event: 'auth.callback.not_configured', missing });
        return finishFlow(origin, this.#failurePath(purpose, 'error'));
      }

      const context: FlowContext = {
        request,
        env,
        origin,
        returnTo: safeReturnPath(
          request.cookies.get(this.#config.returnCookie)?.value,
        ),
      };
      let step: CallbackStep = 'exchange';
      try {
        await setErrorContext({ 'auth.step': step });
        const client = this.#client();
        const tokens = await client.exchangeCode({
          code,
          redirectUri: `${origin}/auth/callback`,
        });
        if (!tokens.ok) {
          await setErrorContext({ 'auth.failure': FAILURE_AT[step] });
          logError({
            event: 'auth.callback.failed',
            error: `token exchange: http ${tokens.status}`,
          });
          return finishFlow(origin, this.#failurePath(purpose, 'error'));
        }
        step = 'userinfo';
        await setErrorContext({ 'auth.step': step });
        const info = await client.getUserInfo(tokens.value.access_token);
        if (!info.ok) {
          await setErrorContext({ 'auth.failure': FAILURE_AT[step] });
          logError({
            event: 'auth.callback.failed',
            error: `userinfo: http ${info.status}`,
          });
          return finishFlow(origin, this.#failurePath(purpose, 'error'));
        }
        step = 'finish';
        await setErrorContext({ 'auth.step': step });
        if (purpose === this.#config.signInPurpose) {
          const done = await this.#config.completeSignIn(context, info.value);
          await setErrorContext({ 'auth.step': 'done' });
          return done;
        }
        const other = this.#config.otherFlows[purpose];
        if (!other) {
          throw new Error(`No flow is registered for "${purpose}"`);
        }
        const done = await other.complete(context, info.value, tokens.value);
        await setErrorContext({ 'auth.step': 'done' });
        return done;
      } catch (err) {
        await setErrorContext({ 'auth.failure': FAILURE_AT[step] });
        logError({
          event: 'auth.callback.failed',
          error:
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        return finishFlow(origin, this.#failurePath(purpose, 'error'));
      }
    };
  }

  /** The signed-in user for the current request, or null. */
  currentUser(): Promise<User | null> {
    return getCurrentUser();
  }
}
