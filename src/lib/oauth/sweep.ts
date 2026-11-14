/**
 * @packageDocumentation
 *
 * The occasional background clean-up of OAuth data. There is no scheduled job,
 * so a small share of token and registration requests start one after they have
 * answered; this keeps the tables from growing without a cron trigger.
 */

import { shouldPurge, unitRandom } from '@/lib/oauth/retention';

/** The two sweeps a clean-up runs: stale OAuth rows, and idle rate-limit counters. */
export interface Sweeps {
  readonly purgeOAuth: () => Promise<unknown>;
  readonly purgeRateLimits: () => Promise<unknown>;
}

/**
 * Start a clean-up for roughly one request in a hundred (`random` is a number
 * in [0, 1), a parameter so tests need no luck). `runInBackground` takes the
 * work and runs it after the response; failures there are its concern. Returns
 * whether a clean-up was started.
 */
export function sweepSometimes(
  sweeps: Readonly<Sweeps>,
  runInBackground: (work: Promise<unknown>) => void,
  random: number = unitRandom(),
): boolean {
  if (!shouldPurge(random)) {
    return false;
  }
  runInBackground(Promise.all([sweeps.purgeOAuth(), sweeps.purgeRateLimits()]));
  return true;
}
