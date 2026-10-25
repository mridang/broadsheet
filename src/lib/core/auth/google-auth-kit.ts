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
import type { GoogleUser } from '@/lib/google/auth';
import { checkState, newState, safeReturnPath } from '@/lib/web-security';
import { finishFlow, startFlowCookies } from './flow-cookies';
import { getCurrentUser } from './current-user';
import type { FlowContext, OtherFlow } from '@/domain/auth/sign-in';
import type { User } from '@/domain/auth/store';
import { problem } from '@/lib/rest-json';
import { getEnv } from '@/lib/core/runtime';
import { appOrigin } from '@/lib/core/origin';
import { logError, logWarn } from '@/utils/logging';

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
    info: GoogleUser,
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

  #client(origin: string): GoogleOAuthClient {
    const env = getEnv();
    return new GoogleOAuthClient({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: `${origin}/auth/callback`,
    });
  }

  /** `GET /auth/login`: send the browser to Google to sign in. */
  loginHandler(): (request: NextRequest) => Response {
    return (request) => {
      const env = getEnv();
      const missing = this.#config.missingSignInSettings(env);
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
      const state = newState(this.#config.signInPurpose);
      const response = NextResponse.redirect(
        this.#client(origin).authUrl({ state, scopes: this.#config.scopes }),
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

      const checked = checkState(state, expectedState, this.#config.purposes);
      if (!checked.ok) {
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
      if (!code) {
        logWarn({ event: 'auth.callback.no_code', purpose, oauthError });
        return finishFlow(origin, this.#failurePath(purpose, 'denied'));
      }
      const missing = this.#config.missingSignInSettings(env);
      if (missing.length > 0) {
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
      try {
        const client = this.#client(origin);
        const tokens = await client.exchangeCode(code);
        const info = await client.userInfo(tokens.access_token);
        if (purpose === this.#config.signInPurpose) {
          return await this.#config.completeSignIn(context, info);
        }
        const other = this.#config.otherFlows[purpose];
        if (!other) {
          throw new Error(`No flow is registered for "${purpose}"`);
        }
        return await other.complete(context, info, tokens);
      } catch (err) {
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
