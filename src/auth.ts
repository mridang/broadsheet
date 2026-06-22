// Google OAuth 2.0 / OpenID Connect — authorization-code flow. Port of auth.mjs.
import type { Env, OAuthProfile } from "./types";

export const oauthConfigured = (env: Env): boolean =>
  !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function authUrl(env: Env, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "="));
  // atob yields a binary string; decode it as UTF-8 so non-ASCII names survive.
  const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function exchange(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const j = (await r.json()) as { id_token?: string };
  if (!j.id_token) throw new Error("token exchange failed: " + JSON.stringify(j));
  // id_token comes straight from Google over TLS; decode (don't re-verify) the claims.
  const c = decodeJwtClaims(j.id_token);
  const email = String(c.email ?? "");
  return {
    sub: String(c.sub ?? ""),
    email,
    name: String(c.name ?? email),
    picture: String(c.picture ?? ""),
  };
}
