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

import { createDatabase } from './lib/db';
import { refreshAll } from './lib/scraping';

const handler = {
  /** Forwarded straight to OpenNext's Next.js handler. */
  fetch(request, env, ctx) {
    return openNextHandler.fetch(request, env, ctx);
  },

  /** Daily cron — refresh every feed (public + all users). */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      refreshAll(createDatabase(env.DB), env).catch((err) => {
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
