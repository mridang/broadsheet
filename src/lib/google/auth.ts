/**
 * @packageDocumentation
 *
 * Server-side Google OAuth 2.0 (authorization-code flow), as far as signing in
 * needs it: build the consent URL, trade the code for tokens, ask Google who
 * the person is. It runs on the Worker, so the client secret never reaches a
 * browser.
 *
 * Signing in asks for identity only (`openid`, `email`, `profile`), which is
 * non-sensitive and needs no Google security assessment. The handle is
 * {@link GoogleOAuthClient}, built with the app's client credentials and used
 * through {@link GoogleOAuthClient.authUrl}, {@link GoogleOAuthClient.exchangeCode}
 * and {@link GoogleOAuthClient.userInfo}; an ask that needs more passes `extra`
 * consent parameters to `authUrl`.
 */

/** What signing in asks Google for: who the person is, nothing else. */
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

/** Where people are sent to approve the request. */
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Where codes and refresh tokens are traded for access tokens. */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Who the person behind an access token is. */
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * The identity fields we keep from the OpenID userinfo response. Only `sub` is
 * always there: a grant that carries just `openid` answers with nothing else.
 */
export interface GoogleUser {
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

/** Tokens returned by the authorization-code exchange. */
export interface TokenResponse {
  readonly access_token: string;
  /** Present only on the first consent (or with `prompt=consent`). */
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly id_token?: string;
  /**
   * The scopes actually granted, space-separated. Google lets people untick
   * individual permissions on the consent screen, so this can be fewer than
   * were asked for.
   */
  readonly scope?: string;
}

/**
 * A short-lived access token minted from a refresh token.
 * @public
 */
export interface AccessTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

/** Whether a value is an object with a string at `key`. */
function hasString(value: object, key: string): boolean {
  return typeof Reflect.get(value, key) === 'string';
}

/**
 * Whether a parsed response carries an access token and its lifetime.
 * @public
 */
export function isAccessTokenResponse(
  value: unknown,
): value is AccessTokenResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasString(value, 'access_token') &&
    'expires_in' in value &&
    typeof value.expires_in === 'number'
  );
}

/** Whether a parsed response is a user we can use: it names who they are. */
function isGoogleUser(value: unknown): value is GoogleUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasString(value, 'sub') &&
    (!('email' in value) || typeof value.email === 'string')
  );
}

/** The app's Google OAuth client credentials and callback address. */
export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** What {@link GoogleOAuthClient.authUrl} needs for one consent request. */
export interface AuthUrlParams {
  /** The CSRF/one-time value the callback validates. */
  readonly state: string;
  readonly scopes: readonly string[];
  /** Extra consent parameters (e.g. `access_type=offline`); signing in needs none. */
  readonly extra?: Readonly<Record<string, string>>;
}

/**
 * Server-side Google OAuth 2.0 client. Built once with the app's credentials,
 * then used to start a consent round trip and finish it. The client secret
 * stays on the Worker.
 */
export class GoogleOAuthClient {
  readonly #config: GoogleOAuthConfig;
  readonly #fetcher: typeof fetch;

  constructor(
    config: GoogleOAuthConfig,
    // Resolved per call so a test can replace the global `fetch` after
    // construction.
    fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.#config = config;
    this.#fetcher = fetcher;
  }

  /** Build the Google consent URL to redirect the user to. */
  authUrl({ state, scopes, extra }: AuthUrlParams): string {
    const query = new URLSearchParams({
      client_id: this.#config.clientId,
      redirect_uri: this.#config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      ...extra,
      state,
    });
    return `${AUTH_ENDPOINT}?${query}`;
  }

  /** POST a form to Google's token endpoint; `what` names the step in the error. */
  async #postToken(
    form: Readonly<Record<string, string>>,
    what: string,
  ): Promise<unknown> {
    const response = await this.#fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    if (!response.ok) {
      throw new Error(
        `${what} failed: ${response.status} ${await response.text()}`,
      );
    }
    return response.json();
  }

  /** Exchange an authorization code for access (and, if asked for, refresh) tokens. */
  async exchangeCode(code: string): Promise<TokenResponse> {
    const tokens = await this.#postToken(
      {
        code,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        redirect_uri: this.#config.redirectUri,
        grant_type: 'authorization_code',
      },
      'Token exchange',
    );
    if (!isAccessTokenResponse(tokens)) {
      throw new Error('Token exchange failed: unexpected response');
    }
    return tokens;
  }

  /** Fetch the signed-in user's identity from the OpenID userinfo endpoint. */
  async userInfo(accessToken: string): Promise<GoogleUser> {
    const response = await this.#fetcher(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`userinfo failed: ${response.status}`);
    }
    const user: unknown = await response.json();
    if (!isGoogleUser(user)) {
      throw new Error('userinfo failed: unexpected response');
    }
    return user;
  }
}
