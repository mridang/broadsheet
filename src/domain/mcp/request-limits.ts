/**
 * @packageDocumentation
 *
 * The limits that protect the MCP endpoint from a caller who sends too much or
 * too often: a cap on how large a request body may be (read by the shared
 * streamed reader in `../http/body.ts`, which stops early instead of buffering
 * what it will refuse), and a per-user rate limit (the tools spec requires one
 * on tool invocations).
 */

import type { User } from '@/domain/db/users';
import {
  readJsonBody as readJsonBodyUpTo,
  type JsonBody,
} from '@/lib/core/api';
import { runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/client';
import { errorMessage, logError } from '@/utils/logging';
import {
  D1RateLimitStore,
  purgeRateLimits,
  rateLimit,
  type RateLimit,
  type RateLimitStore,
} from '@/lib/rate-limit';
import {
  ERROR_INTERNAL,
  isNotification,
  protocolRefusal,
  replyIdOf,
  type ProtocolMessage,
  type ReplyId,
  type ProtocolRefusal,
} from '@/lib/mcp';

/** The largest request body, in bytes. An import page is the biggest legitimate message and fits easily. */
export const MAX_BODY_BYTES = 1_048_576;

/** The most messages one POST may carry (older clients may batch; they run side by side). */
export const MAX_BATCH = 20;

/**
 * How many requests one user may make: tool calls are the costly ones (a Drive
 * round trip, sometimes a model call), so they get a tight budget; everything
 * else (listing tools, reading a view, the handshake) a much roomier one.
 */
export const MCP_RATE_LIMITS = {
  /** Calls to `tools/call`: two a second, on average. */
  toolCall: { name: 'mcp-tool-call', limit: 120, windowSeconds: 60 },
  /** Every other request that expects a reply. */
  request: { name: 'mcp-request', limit: 600, windowSeconds: 60 },
} as const satisfies Readonly<Record<string, RateLimit>>;

/** The fraction of requests that also sweep away idle counters. */
export const PURGE_PROBABILITY = 0.01;

/** How long, in seconds, a counter must have been idle before a sweep removes it. */
export const PURGE_IDLE_SECONDS = 3600;

/** What reading a request body came to: its JSON, or why it could not be had. */
export type BodyResult = JsonBody;

/**
 * Read the request body as JSON, refusing anything over {@link MAX_BODY_BYTES}.
 * A declared `Content-Length` over the limit is refused without reading a byte;
 * a body with no declared length (chunked) is read piece by piece and dropped
 * as soon as it grows past the limit, so a big upload is never held in memory.
 * Text that is not valid UTF-8 or not valid JSON is `unparseable`.
 */
export function readJsonBody(request: Request): Promise<BodyResult> {
  return readJsonBodyUpTo(request, MAX_BODY_BYTES);
}

/** Where the rate limiter keeps its counters and how it tells the time and rolls dice. */
export interface RateLimitDeps {
  /** The counters; a function so the database is only touched when a limit is checked. */
  readonly store: () => RateLimitStore;
  /** The time now, in Unix seconds. */
  readonly now: () => number;
  /** A random number in [0, 1), for deciding when to sweep idle counters. */
  readonly random: () => number;
}

/** The real thing: counters in D1, the clock and `Math.random`. */
export function liveRateLimitDeps(): RateLimitDeps {
  return {
    store: () => new D1RateLimitStore(getDatabase().$client),
    now: () => Math.floor(Date.now() / 1000),
    random: Math.random,
  };
}

/** The limit a message counts against, or undefined for one that expects no reply. */
function limitFor(message: ProtocolMessage): RateLimit | undefined {
  if (isNotification(message)) {
    return undefined;
  }
  return message.method === 'tools/call'
    ? MCP_RATE_LIMITS.toolCall
    : MCP_RATE_LIMITS.request;
}

/** The refusal for a user over a limit: HTTP 429 with `Retry-After`. */
function tooManyRequests(
  limit: RateLimit,
  retryAfterSeconds: number,
  id: ReplyId,
): ProtocolRefusal {
  return protocolRefusal({
    status: 429,
    id,
    // The protocol defines no code for "slow down"; this is the closest standard one.
    code: ERROR_INTERNAL,
    message: `Rate limit reached: at most ${limit.limit} requests of this kind every ${limit.windowSeconds} seconds. Try again in ${retryAfterSeconds} seconds.`,
    data: {
      retryAfterSeconds,
      limit: limit.limit,
      windowSeconds: limit.windowSeconds,
    },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}

/**
 * Count one hit against each of `limits` for `user` and return the 429 refusal
 * if any is over, or null if all may go ahead. On roughly one request in a
 * hundred this also sweeps away counters that have been idle for an hour. If the
 * counters cannot be reached the request goes ahead (and the fault is logged):
 * the limit is a safeguard, and a database hiccup should not take the endpoint
 * down. `id` is the request the refusal answers, when there is just one.
 */
async function enforce(
  user: Readonly<User>,
  limits: readonly RateLimit[],
  id: ReplyId,
  deps: RateLimitDeps,
): Promise<ProtocolRefusal | null> {
  if (limits.length === 0) {
    return null;
  }
  try {
    const store = deps.store();
    const now = deps.now();
    const decisions = await Promise.all(
      limits.map(async (limit) => ({
        limit,
        decision: await rateLimit(store, limit, String(user.id), now),
      })),
    );
    if (deps.random() < PURGE_PROBABILITY) {
      runInBackground(purgeRateLimits(store, PURGE_IDLE_SECONDS, now));
    }
    const over = decisions.flatMap(({ limit, decision }) =>
      decision.allowed
        ? []
        : [{ limit, retryAfter: decision.retryAfterSeconds }],
    );
    const [first] = over.toSorted((a, b) => b.retryAfter - a.retryAfter);
    return first ? tooManyRequests(first.limit, first.retryAfter, id) : null;
  } catch (error) {
    logError({
      event: 'mcp.rate_limit_check_failed',
      error: errorMessage(error),
    });
    return null;
  }
}

/**
 * Count each message against `user`'s limits and return the 429 refusal if any
 * is over, or null if all may go ahead. Each message in a batch counts, so
 * batching is no way round the limit. The refusal names the request when there
 * was just the one.
 */
export async function checkRateLimits(
  user: Readonly<User>,
  messages: readonly ProtocolMessage[],
  deps: RateLimitDeps = liveRateLimitDeps(),
): Promise<ProtocolRefusal | null> {
  const [only] = messages;
  return enforce(
    user,
    messages.flatMap((message) => {
      const limit = limitFor(message);
      return limit ? [limit] : [];
    }),
    messages.length === 1 ? replyIdOf(only?.id) : null,
    deps,
  );
}

/**
 * Count a body that could not be read as messages (too large, not JSON, not a
 * message, a batch of the wrong size) once against the caller's general
 * allowance, and return the 429 refusal if that puts them over, or null. Such a
 * body is refused before anything runs, but the server still read and parsed it,
 * so without this a token holder could send junk without end; the generous
 * general limit leaves a client with the odd bug plenty of room.
 */
export function chargeRefusedBody(
  user: Readonly<User>,
  deps: RateLimitDeps = liveRateLimitDeps(),
): Promise<ProtocolRefusal | null> {
  return enforce(user, [MCP_RATE_LIMITS.request], null, deps);
}
