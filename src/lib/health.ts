/**
 * @packageDocumentation
 *
 * What this app checks about itself for `GET /api/health`, beyond whether the
 * Worker is up and the database is bound (`src/app/api/health/route.ts`, which
 * is the same in every app). An app with nothing more to check answers that all
 * is well.
 */

/** The outcome of the app's own check. */
export interface AppHealth {
  /** Whether the app is healthy; false turns the answer into a 503. */
  readonly ok: boolean;
  /** Extra fields for the body of the answer. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** The app's own check: nothing beyond the Worker answering. */
export function appHealth(): Promise<AppHealth> {
  return Promise.resolve({ ok: true, details: {} });
}
