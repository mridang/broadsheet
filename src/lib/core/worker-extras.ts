/**
 * @packageDocumentation
 *
 * What this app adds to the Worker in `src/worker.ts`, which is the same in
 * every app: handlers besides `fetch` (a cron trigger's `scheduled`), and the
 * Workflow or Durable Object classes the Worker must export by name. This app
 * has a daily cron and no classes to export.
 */

import { databaseFrom } from '@/domain/db/database';
import { backfillRecent, refreshAll } from '@/domain/scraping/index';
import { errorMessage, logError } from '@/utils/logging';

/**
 * The handlers this app adds to the Worker, besides `fetch`.
 *
 * `scheduled` is the daily cron: scrape today's edition for every feed, then
 * backfill any missing recent days for the HN feeds from real historical HN
 * data (Algolia). The first run fills the past week; later runs add the new day.
 */
const extraHandlers: Partial<ExportedHandler<CloudflareEnv>> = {
  scheduled(_event, env, ctx) {
    const db = databaseFrom(env.DB);
    ctx.waitUntil(
      (async () => {
        await refreshAll(db, env);
        await backfillRecent(db, env, 7);
      })().catch((error: unknown) => {
        logError({ event: 'scrape.failed', error: errorMessage(error) });
      }),
    );
  },
};

export default extraHandlers;
