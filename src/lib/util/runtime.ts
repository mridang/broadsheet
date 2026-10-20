import { getCloudflareContext } from '@opennextjs/cloudflare';

import { createDatabase, type Database } from '../db/client';

/** The D1 database binding from the current Cloudflare context. */
export function getDB(): D1Database {
  return getCloudflareContext().env.DB;
}

/**
 * Whether the D1 binding can be reached from the current request context.
 * False (not an error) when there is no Cloudflare context or no binding, so
 * health checks can report it.
 */
export function isDatabaseBound(): boolean {
  try {
    return Boolean(getDB());
  } catch {
    return false;
  }
}

/** The full Cloudflare environment (bindings + secrets), typed via env.d.ts. */
export function getEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}

/** A typed Drizzle client bound to the request's D1 binding. */
export function getDatabase(): Database {
  return createDatabase(getDB());
}

/**
 * Run work after the response has been sent, without blocking it. Failures are
 * swallowed (logged) because background work — embedding, cache warming — must
 * never turn a successful request into an error. Falls back to a floating
 * promise outside a Workers request (tests, scripts).
 */
export function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch((err: unknown) => {
    console.error('background task failed', err);
  });
  try {
    getCloudflareContext().ctx.waitUntil(guarded);
  } catch {
    // No request context: the promise already runs; nothing to extend.
  }
}
