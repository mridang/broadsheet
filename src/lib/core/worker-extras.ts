/**
 * @packageDocumentation
 *
 * What this app adds to the Worker in `src/worker.ts`, which is the same in
 * every app: handlers besides `fetch` (a cron trigger's `scheduled`), and the
 * Workflow or Durable Object classes the Worker must export by name. This app
 * has a daily cron that starts the {@link DailyScrape} Workflow.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';

import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import {
  FETCH_FAILED,
  backfillRecent,
  scrapeSource,
  type Fetchable,
} from '@/domain/scraping/index';
import { errorMessage, logError, logInfo } from '@/utils/logging';

/** How a source's fetch is retried before it is recorded as failed. */
const FETCH_STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
} as const;

/**
 * The daily scrape, as a Workflow: list the sources somebody follows, fetch
 * each as its own step (retried on its own, so one slow or broken feed neither
 * holds up nor reruns the others), then backfill the recent HN editions. A
 * source that still fails after its retries has the failure recorded on it and
 * the run moves on. The edition is the day the run was started, so a step
 * replayed after midnight still writes the same day.
 */
export class DailyScrape extends WorkflowEntrypoint<CloudflareEnv> {
  override async run(
    event: Readonly<WorkflowEvent<unknown>>,
    step: WorkflowStep,
  ): Promise<{ sources: number; ok: number; articles: number }> {
    const db = databaseFrom(this.env.DB);
    const edition = event.timestamp.toISOString().slice(0, 10);
    const sources = await step.do('list sources', async () =>
      (await new Repository(db).allSources()).map(({ id, url }): Fetchable => ({
        id,
        url,
      })),
    );
    let ok = 0;
    let articles = 0;
    for (const source of sources) {
      try {
        articles += await step.do(`fetch source ${source.id}`, FETCH_STEP, () =>
          scrapeSource(db, this.env, source, edition),
        );
        ok++;
      } catch (error) {
        await step.do(`record failure of source ${source.id}`, async () => {
          await new Repository(db).recordFetch(
            source.id,
            error instanceof Error ? error.message : FETCH_FAILED,
          );
        });
      }
    }
    await step.do('backfill recent editions', async () => {
      await backfillRecent(db, this.env, 7);
    });
    logInfo({
      event: 'scrape.completed',
      edition,
      sources: sources.length,
      ok,
      articles,
    });
    return { sources: sources.length, ok, articles };
  }
}

/**
 * The handlers this app adds to the Worker, besides `fetch`.
 *
 * `scheduled` is the daily cron: it starts a {@link DailyScrape} run, which
 * scrapes today's edition for every source and backfills missing recent days
 * for the HN feeds from real historical HN data (Algolia).
 */
const extraHandlers: Partial<ExportedHandler<CloudflareEnv>> = {
  async scheduled(_event, env) {
    try {
      const run = await env.DAILY_SCRAPE.create();
      logInfo({ event: 'scrape.started', run: run.id });
    } catch (error) {
      logError({ event: 'scrape.failed', error: errorMessage(error) });
    }
  },
};

export default extraHandlers;
