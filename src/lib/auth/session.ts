/**
 * @packageDocumentation
 *
 * Stateless signed sessions. After OAuth we don't want to hit the database on
 * every request just to know who is logged in, so the user's id and email are
 * put in a compact token — `base64url(payload).base64url(HMAC-SHA256)` — and
 * stored in an httpOnly cookie. The HMAC (keyed by the `SESSION_SECRET`) makes
 * the token tamper-proof; a bad signature or past expiry yields no session.
 *
 * This is deliberately small: it carries identity only, plus whatever hints an
 * app adds (see `sessionClaims` in `app.ts`). Anything sensitive stays in the
 * database, never in the cookie.
 */

import {
  base64UrlToBytes,
  bufferSource,
  bytesToBase64Url,
} from '../util/base64';
import { SESSION_COOKIE } from './app';

// Re-exported so the cookie's name is read from the same place as the token
// functions that fill it.
export { SESSION_COOKIE };

/** How long a session stays valid, in seconds (30 days). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * The key that signs sessions. There is no fallback: with no secret, signing in
 * fails and no session is ever honoured, rather than signing with a value
 * anyone could guess.
 */
export function requireSessionSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error('SESSION_SECRET is not set, so sessions cannot be signed');
  }
  return secret;
}

/** The extra claims an app adds (see `sessionClaims` in `app.ts`): plain values only. */
interface ExtraClaims {
  readonly [claim: string]: string | number | boolean | undefined;
}

/** The claims carried in the session token. */
export interface SessionPayload extends ExtraClaims {
  /** `users.id` primary key. */
  readonly uid: number;
  readonly email: string;
  /**
   * The Google display name and profile photo address, so the header can greet
   * the person without a database read. Absent on sessions issued before they
   * were added; those fall back to a lookup.
   */
  readonly name?: string;
  readonly picture?: string;
  /**
   * The session epoch the person had when this was issued (`users.session_epoch`).
   * The session is honoured only while the database still holds the same
   * number, which is how "sign out everywhere" ends a stolen or forgotten
   * session. Absent on sessions issued before it existed; those count as epoch 0.
   */
  readonly ep?: number;
  /** Expiry as a Unix timestamp (seconds). */
  readonly exp: number;
}

/** What goes into a new token: the claims of a payload, with the expiry optional. */
export type NewSession = ExtraClaims & {
  readonly uid: number;
  readonly email: string;
  readonly name?: string;
  readonly picture?: string;
  readonly ep?: number;
  readonly exp?: number;
};

/** The HMAC-SHA-256 key for a session secret, usable for signing and verifying. */
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    bufferSource(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Create a signed session token for a user. `exp` defaults to now +
 * {@link SESSION_TTL_SECONDS} but can be supplied (e.g. in tests).
 */
export async function createSessionToken(
  payload: NewSession,
  secret: string,
): Promise<string> {
  const { uid, email, name, picture, ep, exp, ...extra } = payload;
  const full: SessionPayload = {
    // The app's own claims go first so they can never replace the ones below.
    ...Object.fromEntries(
      Object.entries(extra).filter(([, value]) => value !== undefined),
    ),
    uid,
    email,
    // Kept short: the whole token travels in a cookie on every request.
    ...(name ? { name: name.slice(0, 80) } : {}),
    ...(picture && picture.length <= 400 ? { picture } : {}),
    ...(ep !== undefined ? { ep } : {}),
    exp: exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(full)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      bufferSource(new TextEncoder().encode(body)),
    ),
  );
  return `${body}.${bytesToBase64Url(sig)}`;
}

/**
 * Verify a session token: checks the signature (constant-time via
 * `crypto.subtle.verify`) and the expiry. Returns the payload or null.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await hmacKey(secret);
  if (!(await signatureValid(key, body, sig))) {
    return null;
  }
  const payload = parsePayload(body);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

/** Whether `sig` (URL-safe base64) is the HMAC of `body` under `key`; malformed signatures are simply invalid. */
async function signatureValid(
  key: CryptoKey,
  body: string,
  sig: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      key,
      bufferSource(base64UrlToBytes(sig)),
      bufferSource(new TextEncoder().encode(body)),
    );
  } catch {
    return false;
  }
}

/** The claims inside a token body, or null if it isn't JSON of the right shape. */
function parsePayload(body: string): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(body)),
    );
    return isSessionPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether a parsed value carries the claims every session token we issue has. */
function isSessionPayload(value: unknown): value is SessionPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'exp' in value &&
    typeof value.exp === 'number' &&
    // Optional, but a wrong type means the token is not one of ours.
    (!('ep' in value) || typeof value.ep === 'number')
  );
}

/**
 * Whether a verified session is still the current generation for its person:
 * the epoch it carries (0 for one issued before epochs existed) equals the
 * epoch in the database. A signature and an expiry only prove the cookie was
 * issued by us once; this is what makes it revocable.
 */
export function sessionIsCurrent(
  payload: Readonly<Pick<SessionPayload, 'ep'>>,
  dbEpoch: number,
): boolean {
  return (payload.ep ?? 0) === dbEpoch;
}
