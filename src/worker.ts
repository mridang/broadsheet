// @ts-nocheck — this is the wrangler entry, not part of the Next app. It
// statically imports `../.open-next/worker.js`, which OpenNext only emits
// during `opennextjs-cloudflare build` (after `next build`). That module
// can't exist at type-check time, so this glue file is excluded from
// tsconfig; wrangler resolves the import at bundle time.
/**
 * @packageDocumentation
 *
 * Production Worker entry point. OpenNext generates the Next.js fetch
 * handler into `.open-next/worker.js`; this file composes it with the
 * `scheduled()` handler that the daily cron trigger fires into.
 *
 *   1. `wrangler.jsonc` -> `main` set to this file.
 *   2. `next build && opennextjs-cloudflare build` produces the handler.
 *   3. `wrangler deploy` bundles this file.
 */
import openNextHandler from '../.open-next/worker.js';

import { createDatabase } from './lib/db/client';
import { serve } from './lib/http/serve';
import { backfillRecent, refreshAll } from './lib/scraping';

const handler = {
  /**
   * Forwarded to OpenNext's Next.js handler through `serve`, which adds the
   * Content Security Policy nonce on the way in and the security headers on
   * the way out (see `lib/http/serve.ts`).
   */
  fetch(request, env, ctx) {
    return serve(request, env, ctx, { app: openNextHandler });
  },

  /**
   * Daily cron: scrape today's edition for every feed, then backfill any
   * missing recent days for the HN feeds from real historical HN data
   * (Algolia). The first run fills the past week; later runs add the new day.
   */
  async scheduled(event, env, ctx) {
    const db = createDatabase(env.DB);
    ctx.waitUntil(
      (async () => {
        await refreshAll(db, env);
        await backfillRecent(db, env, 7);
      })().catch((err) => {
        console.error(
          JSON.stringify({
            event: 'scrape.failed',
            error: err instanceof Error ? err.message : String(err),
            ts: new Date().toISOString(),
          }),
        );
      }),
    );
  },
};

export default handler;
