/**
 * @packageDocumentation
 *
 * How the Worker answers a request, kept out of `src/worker.ts` (which cannot be
 * type-checked, because the app it forwards to is generated at build time) so
 * that it can be checked and tested:
 *
 *  1. a caller over a rate limit is refused at once (`edge-limits.ts`), before
 *     anything is looked up, so a page that is cached still counts;
 *  2. a kept page may come from the edge copy (`edge-cache.ts`), with a fresh
 *     Content Security Policy nonce of its own;
 *  3. everything else goes to the app, with the policy and its nonce on the
 *     request (that is where Next.js looks for it) and on the response;
 *  4. whatever goes back carries the site's security and cache headers, and a
 *     `Server-Timing` header with how long the Worker took and where.
 *
 * This file is the same in every app. What an app counts against its rate
 * limits is in its own `extras.ts`, which has the same exports everywhere.
 */

import { buildCsp, cspSurfaceFor, forwardedHeaders, newNonce } from './csp';
import {
  edgeCache,
  edgeCacheKey,
  isEdgeCacheable,
  storableCopy,
  withFreshNonce,
} from './edge-cache';
import {
  edgeLimitRefusal,
  type EdgeLimitEnv,
  type EdgeLimits,
} from './edge-limits';
import { EDGE_LIMITS } from './extras';
import { applyResponseHeaders, replacingHeaders } from './headers';
import { CACHED_QUERY_PARAMS, EDGE_CACHED_PAGES } from './site';

/** What the Worker is given besides the request. */
export type ServeEnv = EdgeLimitEnv & {
  readonly CF_VERSION_METADATA?: { readonly id?: string };
};

/** The app that answers what the edge does not: the generated OpenNext handler. */
export interface ServeApp {
  fetch(
    request: Request,
    env: never,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
}

/** The pieces `serve` works with, passed in so a test can supply its own. */
export interface ServeDeps {
  readonly app: ServeApp;
  /** The edge cache, or undefined where there is none (plain Node). */
  readonly cache?: Cache | undefined;
  /** What is rate limited, and how; the app's own unless a test supplies another. */
  readonly limits?: EdgeLimits;
  /** The pages the edge may keep a copy of; the app's own unless a test supplies others. */
  readonly pages?: ReadonlySet<string>;
  /** The query parameters a kept page may carry; the app's own unless a test supplies others. */
  readonly queryParams?: ReadonlySet<string>;
}

/** The response with one more header (responses from the app are read-only). */
function withHeader(response: Response, name: string, value: string): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: replacingHeaders(response.headers, { [name]: value }),
  });
}

/** What happened to a request, for the `Server-Timing` header. */
interface Timing {
  /** What the edge cache did: kept page served, looked and missed, or not consulted. */
  edge: 'hit' | 'miss' | 'skip';
  /** Milliseconds the app took, when it was asked. */
  appMs?: number;
}

/** Milliseconds as `Server-Timing` wants them: a number with at most one decimal. */
function ms(value: number): string {
  return String(Math.round(Math.max(value, 0) * 10) / 10);
}

/** The `Server-Timing` value: the total, the edge cache outcome and, if asked, the app. */
export function serverTiming(totalMs: number, timing: Timing): string {
  return [
    `total;dur=${ms(totalMs)}`,
    `edge;desc="${timing.edge}"`,
    ...(timing.appMs === undefined ? [] : [`app;dur=${ms(timing.appMs)}`]),
  ].join(', ');
}

/** Longest `X-Flow-ID` accepted from a caller, and the characters it may use. */
const FLOW_ID = /^[A-Za-z0-9._:~-]{1,128}$/;

/**
 * Answer one request. Every answer carries an `X-Flow-ID`: the caller's own
 * when it sent a sane one, otherwise a fresh one. The app sees the same id on
 * the request, so a request can be followed through the logs.
 */
export async function serve(
  request: Request,
  env: ServeEnv,
  ctx: ExecutionContext,
  deps: ServeDeps,
): Promise<Response> {
  const sent = request.headers.get('X-Flow-ID');
  const flowId =
    sent !== null && FLOW_ID.test(sent) ? sent : crypto.randomUUID();
  const tagged = new Request(request, {
    headers: replacingHeaders(request.headers, { 'X-Flow-ID': flowId }),
  });
  const started = performance.now();
  const timing: Timing = { edge: 'skip' };
  const response = await answer(tagged, env, ctx, deps, timing);
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  // The Workers clock only moves on I/O, so small values are normal. Any
  // timing the app already sent is kept.
  const own = serverTiming(performance.now() - started, timing);
  const sentTiming = response.headers.get('Server-Timing');
  return withHeader(
    withHeader(response, 'X-Flow-ID', flowId),
    'Server-Timing',
    sentTiming ? `${sentTiming}, ${own}` : own,
  );
}

/** Answer one request, after it has been given its flow id. */
async function answer(
  request: Request,
  env: ServeEnv,
  ctx: ExecutionContext,
  {
    app,
    cache = edgeCache(),
    limits = EDGE_LIMITS,
    pages = EDGE_CACHED_PAGES,
    queryParams = CACHED_QUERY_PARAMS,
  }: ServeDeps,
  timing: Timing,
): Promise<Response> {
  const refused = await edgeLimitRefusal(request, env, limits);
  if (refused) {
    return applyResponseHeaders(request, refused);
  }
  // Each page gets its own Content Security Policy, with a one-time number the
  // app puts on its scripts. The approval screen may not be framed by anyone,
  // not even this site.
  const nonce = newNonce();
  const csp = buildCsp(nonce, cspSurfaceFor(new URL(request.url).pathname));
  const key =
    cache !== undefined &&
    isEdgeCacheable(request, pages, limits.sessionCookie, queryParams)
      ? edgeCacheKey(request, env.CF_VERSION_METADATA?.id ?? 'dev', queryParams)
      : undefined;
  if (cache && key) {
    const hit = await cache.match(key);
    timing.edge = hit ? 'hit' : 'miss';
    if (hit) {
      return applyResponseHeaders(
        request,
        await withFreshNonce(hit, nonce, csp),
      );
    }
  }
  const forwarded = new Request(request, {
    headers: forwardedHeaders(request.headers, csp, nonce),
  });
  const appStarted = performance.now();
  const fetched = await app.fetch(forwarded, env as never, ctx);
  timing.appMs = performance.now() - appStarted;
  const isHtml = (fetched.headers.get('content-type') ?? '').startsWith(
    'text/html',
  );
  const response =
    isHtml && !fetched.headers.has('content-security-policy')
      ? withHeader(fetched, 'Content-Security-Policy', csp)
      : fetched;
  if (cache && key) {
    const copy = storableCopy(response);
    if (copy) {
      ctx.waitUntil(cache.put(key, copy));
    }
  }
  return applyResponseHeaders(request, response);
}
