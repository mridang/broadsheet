/**
 * @packageDocumentation
 *
 * Rate limits for the OAuth endpoints that anyone on the internet can reach
 * without signing in: registering a client, making us fetch a client's metadata
 * document, and asking for tokens. Each is a fixed-window counter in D1 (see
 * `util/rate-limit`) keyed by whoever is asking; a request over its limit is
 * answered with 429 and a `Retry-After`.
 *
 * Counting is best-effort. If the counter cannot be reached the request goes
 * ahead (and the failure is logged): a broken limiter must never lock every
 * assistant out of the app.
 */

import { errorMessage, logError } from '@/utils/logging';
import { oauthError } from '@/lib/oauth/http';
import { logSecurityEvent } from '@/lib/oauth/security-log';
import { clientSubject } from '@/lib/core/http/client-address';
import {
  rateLimit,
  type RateLimit,
  type RateLimitStore,
} from '@/lib/rate-limit';
import { countOf } from '@/lib/intl';

/**
 * The limits. Registration is generous per hour (a legitimate assistant
 * registers once) but tight enough to stop a flood of throwaway client rows;
 * metadata fetches are limited per host (one misbehaving client cannot make us
 * hammer its server), per asking address (so one caller with many hostnames
 * cannot use up the overall allowance for everyone else) and overall (nobody can
 * make us a fetch proxy); the token and revoke endpoints allow far more than any
 * real client uses per address, since an assistant's servers share addresses
 * between many users.
 */
export const OAUTH_LIMITS = {
  register: { name: 'oauth-register', limit: 20, windowSeconds: 60 * 60 },
  cimdHost: { name: 'oauth-cimd-host', limit: 10, windowSeconds: 60 },
  cimdAddress: { name: 'oauth-cimd-address', limit: 20, windowSeconds: 60 },
  cimdAll: { name: 'oauth-cimd-all', limit: 60, windowSeconds: 60 },
  revoke: { name: 'oauth-revoke', limit: 60, windowSeconds: 60 },
  token: { name: 'oauth-token', limit: 120, windowSeconds: 60 },
} as const satisfies Readonly<Record<string, RateLimit>>;

/**
 * Who is asking, as a rate-limit subject: the address Cloudflare saw, with an
 * IPv6 address reduced to its /64 so a caller cannot get a fresh counter by
 * rotating through the addresses of their own network. The rule itself lives in
 * `http/client-address`, shared with the rest of the API.
 */
export function clientAddress(headers: Headers): string {
  return clientSubject(headers);
}

/**
 * Record one hit by `subject` against `limit`. Returns undefined when the
 * request may go ahead, or the seconds to wait when it is over the limit. Fails
 * open: an unreachable counter lets the request through.
 */
export async function retryAfterIfLimited(
  store: RateLimitStore,
  limit: RateLimit,
  subject: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<number | undefined> {
  try {
    const decision = await rateLimit(store, limit, subject, now);
    return decision.allowed ? undefined : decision.retryAfterSeconds;
  } catch (error) {
    logError({
      event: 'oauth.rate_limiter_unavailable',
      error: errorMessage(error),
    });
    return undefined;
  }
}

/**
 * The first of several limits that is exceeded, as seconds to wait; undefined
 * when every limit allows the request. The limits are tried in order and
 * counting stops at the first refusal.
 */
export async function firstRetryAfter(
  store: RateLimitStore,
  checks: readonly Readonly<{ limit: RateLimit; subject: string }>[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<number | undefined> {
  const [first, ...rest] = checks;
  if (!first) {
    return undefined;
  }
  const wait = await retryAfterIfLimited(
    store,
    first.limit,
    first.subject,
    now,
  );
  return wait ?? firstRetryAfter(store, rest, now);
}

/**
 * The OAuth answer for a request over a limit: HTTP 429 with a
 * `Retry-After` and the `temporarily_unavailable` error (RFC 6749 §4.1.2.1's
 * code for a server that cannot handle the request right now). `endpoint`
 * names the route, for the log line.
 */
export function tooManyRequests(retryAfterSeconds: number, endpoint: string) {
  logSecurityEvent('oauth.rate_limited', { endpoint, retryAfterSeconds });
  return oauthError(
    'temporarily_unavailable',
    `Too many requests. Try again in ${countOf(retryAfterSeconds, 'second')}.`,
    429,
    { 'Retry-After': String(retryAfterSeconds) },
  );
}
