/**
 * Minimal health endpoint for uptime monitors.
 *
 *   GET /health → 200 { ok, db, ts }, or 503 when the app's own check fails
 */

import { appHealth } from '@/lib/health';
import { isDatabaseBound } from '@/lib/util';

/** Never prerender or cache this route: the answer must reflect right now. */
export const dynamic = 'force-dynamic';

/**
 * `GET /health`: reports whether the D1 binding is reachable from the
 * current request context, and whatever else the app checks about itself
 * (`lib/health.ts`, which adds fields to the body and can turn the answer into
 * a 503). Needs no sign-in: the monitor wants to know the Worker is up, and a
 * missing database binding is reported in the body (`db: false`) rather than
 * failing the check.
 */
export async function GET(): Promise<Response> {
  const app = await appHealth();
  return Response.json(
    {
      ok: app.ok,
      db: isDatabaseBound(),
      ts: new Date().toISOString(),
      ...app.details,
    },
    { status: app.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
