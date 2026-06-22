/**
 * @packageDocumentation
 *
 * Google OAuth 2.0 / OpenID Connect — authorization-code flow. No SDK:
 * build the consent URL, exchange the code for an `id_token`, and decode
 * its claims (the token comes straight from Google over TLS).
 */

/** Identity claims lifted from a Google `id_token`. @public */
export interface OAuthProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export const oauthConfigured = (env: CloudflareEnv): boolean =>
  !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function authUrl(
  env: CloudflareEnv,
  redirectUri: string,
  state: string,
): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const segment = idToken.split('.')[1] ?? '';
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
  // atob yields a binary string; decode it as UTF-8 so non-ASCII names survive.
  const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export async function exchange(
  env: CloudflareEnv,
  code: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const j = (await r.json()) as { id_token?: string };
  if (!j.id_token) {
    throw new Error('token exchange failed: ' + JSON.stringify(j));
  }
  const c = decodeJwtClaims(j.id_token);
  const email = String(c['email'] ?? '');
  return {
    sub: String(c['sub'] ?? ''),
    email,
    name: String(c['name'] ?? email),
    picture: String(c['picture'] ?? ''),
  };
}
