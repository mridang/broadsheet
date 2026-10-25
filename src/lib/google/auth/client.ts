/**
 * @packageDocumentation
 *
 * Server-side Google OAuth 2.0 client, built on {@link JsonClient}: build the
 * consent URL, trade a code or a refresh token for tokens, read who the person
 * is, and hand a token back for revocation. It runs on the Worker, so the
 * client secret never reaches a browser.
 *
 * Each network method returns a {@link Result} and never throws for an HTTP or
 * decode error; translating a failure into an exception (and the messages the
 * auth-failure checks parse) is the domain's job — see `@/domain/auth`.
 *
 * Signing in asks for identity only (`openid`, `email`, `profile`), which is
 * non-sensitive and needs no Google security assessment. An app that wants more
 * from Google builds its own request on {@link GoogleOAuthClient.authUrl} and
 * {@link GoogleOAuthClient.exchangeCode}.
 */

import { JsonClient, type Result } from '@/lib/http';

import {
  AccessTokenResponseSchema,
  GoogleUserResponseSchema,
  TokenResponseSchema,
  type AccessTokenResponse,
  type ExchangeCodeRequest,
  type GoogleUserResponse,
  type RefreshTokenRequest,
  type RevokeTokenRequest,
  type RevokeTokenResponse,
  type TokenResponse,
} from './models';

/** What signing in asks Google for: who the person is, nothing else. @public */
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

/** Where people are sent to approve the request. */
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Where codes and refresh tokens are traded for access tokens. */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Who the person behind an access token is. */
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
/** Where a token (and the grant behind it) is given back to Google. */
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** A request that posts `form` as `application/x-www-form-urlencoded`. */
function formPost(form: Readonly<Record<string, string>>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  };
}

/** The client credentials a Google OAuth app is registered with. @public */
export interface GoogleOAuthCredentials {
  readonly clientId: string;
  /** Needed only for the token-endpoint exchanges, not for building a consent URL. */
  readonly clientSecret?: string;
}

/**
 * Server-side Google OAuth 2.0 client for one registered app. Build it with the
 * app's credentials (and, in tests, an injected `fetcher`) and use it to build
 * consent URLs, trade codes and refresh tokens for access tokens, read who the
 * person is, and revoke a token. The client secret stays on the server.
 */
export class GoogleOAuthClient {
  readonly #credentials: GoogleOAuthCredentials;
  readonly #fetch: typeof fetch;
  readonly #http: JsonClient;

  constructor(credentials: GoogleOAuthCredentials, fetcher?: typeof fetch) {
    this.#credentials = credentials;
    // Resolve the global fetch lazily so a test that swaps it still takes effect.
    this.#fetch = fetcher ?? ((input, init) => fetch(input, init));
    // Each method passes an absolute endpoint as the path, so the base is empty.
    this.#http = new JsonClient('', this.#fetch);
  }

  /**
   * Build the Google consent URL to redirect the user to. `state` is the
   * CSRF/one-time value the callback validates. `extra` adds query parameters
   * for an ask that needs them (for example `access_type=offline`); signing in
   * needs none.
   */
  authUrl(
    params: Readonly<{
      redirectUri: string;
      state: string;
      scopes: readonly string[];
      extra?: Readonly<Record<string, string>>;
    }>,
  ): string {
    const query = new URLSearchParams({
      client_id: this.#credentials.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: params.scopes.join(' '),
      ...params.extra,
      state: params.state,
    });
    return `${AUTH_ENDPOINT}?${query}`;
  }

  /** The configured client secret, or a clear error when one is needed but unset. */
  #secret(): string {
    const secret = this.#credentials.clientSecret;
    if (!secret) {
      throw new Error('clientSecret is required for a token exchange');
    }
    return secret;
  }

  /** Exchange an authorization code for access (and, if asked for, refresh) tokens. */
  async exchangeCode(
    request: ExchangeCodeRequest,
  ): Promise<Result<TokenResponse>> {
    return this.#http.request(
      {
        path: TOKEN_ENDPOINT,
        init: formPost({
          code: request.code,
          client_id: this.#credentials.clientId,
          client_secret: this.#secret(),
          redirect_uri: request.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
      TokenResponseSchema,
    );
  }

  /**
   * Mint a fresh access token from a stored refresh token. Used per request
   * (access tokens are short-lived) and by the headless MCP/sync paths.
   */
  async refreshAccessToken(
    request: RefreshTokenRequest,
  ): Promise<Result<AccessTokenResponse>> {
    return this.#http.request(
      {
        path: TOKEN_ENDPOINT,
        init: formPost({
          refresh_token: request.refreshToken,
          client_id: this.#credentials.clientId,
          client_secret: this.#secret(),
          grant_type: 'refresh_token',
        }),
      },
      AccessTokenResponseSchema,
    );
  }

  /** Fetch the signed-in user's identity from the OpenID userinfo endpoint. */
  getUserInfo(accessToken: string): Promise<Result<GoogleUserResponse>> {
    return this.#http.request(
      {
        path: USERINFO_ENDPOINT,
        init: { headers: { Authorization: `Bearer ${accessToken}` } },
      },
      GoogleUserResponseSchema,
    );
  }

  /**
   * Give a token back to Google, ending chowdown's access on Google's side
   * (revoking a refresh token revokes the access tokens minted from it). The
   * endpoint answers with an empty body, so this is a direct fetch rather than
   * a JSON-decoding {@link JsonClient} call.
   */
  async revoke(
    request: RevokeTokenRequest,
  ): Promise<Result<RevokeTokenResponse>> {
    const response = await this.#fetch(
      REVOKE_ENDPOINT,
      formPost({ token: request.token }),
    );
    const raw = await response.text();
    return response.ok
      ? { ok: true, value: {}, raw, status: response.status }
      : {
          ok: false,
          error: `http ${response.status}`,
          raw,
          status: response.status,
        };
  }
}
