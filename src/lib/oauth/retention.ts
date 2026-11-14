/**
 * @packageDocumentation
 *
 * How long OAuth rows are kept. Left alone the OAuth tables only grow: every
 * refresh adds two token rows, every sign-in a code, every anonymous
 * registration a client. Nothing runs on a schedule here, so a small fraction
 * of token and registration requests sweep up in the background; this module
 * decides what counts as stale and when to sweep, and `db/oauth.ts` deletes it.
 */

/** Seconds in a day. */
const DAY = 60 * 60 * 24;

/** How long after expiry a code or token row is kept (a used code is how a replay is recognised). */
export const EXPIRED_ROW_GRACE_SECONDS = DAY;

/**
 * How many live connections one user may have to the same app. Each install of
 * an app (a laptop and a desktop, two editors) approves separately and gets its
 * own grant, so they must coexist; the cap only stops the table growing without
 * bound, retiring the oldest connections beyond it.
 */
export const MAX_LIVE_GRANTS_PER_APP = 10;

/** How long a revoked grant is kept: it anchors its client's registration, so a disconnected app can reconnect. */
export const REVOKED_GRANT_KEEP_SECONDS = 90 * DAY;

/**
 * How long a dynamically registered client that nobody ever approved is kept.
 * Once it is deleted the client's authorization link answers "not known", an
 * HTML page a program cannot read, so the window is generous: a person may
 * well come back to a half-finished connection a few weeks later.
 */
export const UNUSED_DCR_CLIENT_KEEP_SECONDS = 30 * DAY;

/** How long a live grant may go unused before it is ended (half a year; its refresh tokens expire after thirty days of disuse anyway). */
export const IDLE_GRANT_SECONDS = 180 * DAY;

/** How long a cached client metadata document that nobody ever approved is kept. */
export const UNUSED_CIMD_CLIENT_KEEP_SECONDS = 30 * DAY;

/** The chance that a token or registration request also sweeps (one in a hundred). */
export const PURGE_PROBABILITY = 0.01;

/**
 * The points in time before which each kind of row is stale. Times that are
 * compared with integer columns (`expires_at`) are Unix seconds; times compared
 * with text timestamp columns are ISO-8601 strings, which sort the same way.
 */
export interface PurgeCutoffs {
  /** Authorization codes that expired before this are deleted. */
  readonly codesExpiredBefore: number;
  /** Tokens that expired before this are deleted. */
  readonly tokensExpiredBefore: number;
  /** Tokens of grants revoked before this are deleted (they can never work again). */
  readonly revokedTokensBefore: string;
  /** Grants revoked before this are deleted. */
  readonly revokedGrantsBefore: string;
  /** Live grants last used (or created, if never used) before this are revoked. */
  readonly idleGrantsBefore: string;
  /** Dynamically registered clients created before this, with no grant, are deleted. */
  readonly unusedDcrClientsBefore: string;
  /** Cached metadata documents fetched before this, with no grant, are deleted. */
  readonly unusedCimdClientsBefore: string;
}

/** The ISO-8601 text of a moment `ago` seconds before `now` (Unix seconds). */
const isoAgo = (now: number, ago: number): string =>
  new Date((now - ago) * 1000).toISOString();

/** What is stale at `now` (Unix seconds). */
export function purgeCutoffs(now: number): PurgeCutoffs {
  return {
    codesExpiredBefore: now - EXPIRED_ROW_GRACE_SECONDS,
    tokensExpiredBefore: now - EXPIRED_ROW_GRACE_SECONDS,
    revokedTokensBefore: isoAgo(now, EXPIRED_ROW_GRACE_SECONDS),
    revokedGrantsBefore: isoAgo(now, REVOKED_GRANT_KEEP_SECONDS),
    idleGrantsBefore: isoAgo(now, IDLE_GRANT_SECONDS),
    unusedDcrClientsBefore: isoAgo(now, UNUSED_DCR_CLIENT_KEEP_SECONDS),
    unusedCimdClientsBefore: isoAgo(now, UNUSED_CIMD_CLIENT_KEEP_SECONDS),
  };
}

/**
 * Whether this request should also sweep. `random` is a number in [0, 1), a
 * parameter so tests need no luck.
 */
export function shouldPurge(random: number = unitRandom()): boolean {
  return random < PURGE_PROBABILITY;
}

/** A number in [0, 1) from the platform's cryptographic random source. */
export function unitRandom(): number {
  const [word = 0] = crypto.getRandomValues(new Uint32Array(1));
  return word / 2 ** 32;
}
