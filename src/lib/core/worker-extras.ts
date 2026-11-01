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

import { clusterEdition } from '@/domain/clustering';
import { databaseFrom } from '@/domain/db/database';
import { publishEditionIssue, publishIssue } from '@/domain/issues';
import { NotificationRepository } from '@/domain/notifications';
import { notifyNewStories, sendIssueReady } from '@/domain/notify';
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

/** How the steps that call Workers AI or Vectorize are retried. */
const AI_STEP = {
  retries: { limit: 2, delay: '1 minute', backoff: 'exponential' },
  timeout: '10 minutes',
} as const;

/**
 * What a run is asked to do: with `fetchOnly`, just fetch the sources that are
 * due (the five-minute runs); otherwise the whole daily pipeline.
 */
interface ScrapeParams {
  readonly fetchOnly?: boolean;
}

/** The five-minute run that also lays out the paper: 06:00 UTC. */
const DAILY_HOUR = 6;

/**
 * Whether a cron firing at `time` starts the whole daily pipeline rather than
 * a fetch of the sources that are due.
 */
export function isDailyRun(time: number): boolean {
  const at = new Date(time);
  return at.getUTCHours() === DAILY_HOUR && at.getUTCMinutes() < 5;
}

/**
 * The scrape, as a Workflow: list the sources somebody follows that are due
 * (each is scheduled from how often it publishes and how many follow it, as
 * NewsBlur does, and a failing source backs off), fetch
 * each as its own step (retried on its own, so one slow or broken feed neither
 * holds up nor reruns the others), cluster the edition's near-duplicates,
 * tell each person with notifying feeds about the new stories in them,
 * backfill the recent HN editions, then lay out and store each reader's issue
 * as its own step and push a notice to their browsers that it is ready. A
 * source that still fails after its retries has the failure recorded on it and
 * the run moves on. The edition is the day the run was started, so a step
 * replayed after midnight still writes the same day.
 */
export class DailyScrape extends WorkflowEntrypoint<
  CloudflareEnv,
  ScrapeParams
> {
  override async run(
    event: Readonly<WorkflowEvent<ScrapeParams>>,
    step: WorkflowStep,
  ): Promise<{ sources: number; ok: number; articles: number }> {
    const db = databaseFrom(this.env.DB);
    const edition = event.timestamp.toISOString().slice(0, 10);
    const sources = await step.do('list sources', async () =>
      (await new Repository(db).dueSources()).map(
        ({ id, url, etag, last_modified, last_fetched_at }): Fetchable => ({
          id,
          url,
          etag,
          last_modified,
          last_fetched_at,
        }),
      ),
    );
    let ok = 0;
    let articles = 0;
    for (const source of sources) {
      try {
        const result = await step.do(
          `fetch source ${source.id}`,
          FETCH_STEP,
          () => scrapeSource(db, this.env, source, edition),
        );
        articles += result.articles;
        if (!result.failed) ok++;
      } catch (error) {
        await step.do(`record failure of source ${source.id}`, async () => {
          await new Repository(db).recordFetch(
            source.id,
            error instanceof Error ? error.message : FETCH_FAILED,
          );
        });
      }
    }
    if (event.payload?.fetchOnly) {
      logInfo({
        event: 'fetch.completed',
        edition,
        sources: sources.length,
        ok,
        articles,
      });
      return { sources: sources.length, ok, articles };
    }
    const clustered = await step.do('cluster edition', AI_STEP, () =>
      clusterEdition(db, this.env, edition),
    );
    const notified = await step.do('list notified readers', async () => {
      const notifications = new NotificationRepository(db);
      const [feeds, rules] = await Promise.all([
        notifications.notifiedUserIds(),
        notifications.ruleUserIds(),
      ]);
      return [...new Set([...feeds, ...rules])].toSorted((a, b) => a - b);
    });
    for (const reader of notified) {
      try {
        await step.do(`notify new stories for user ${reader}`, () =>
          notifyNewStories(this.env, db, reader, edition),
        );
      } catch (error) {
        logError({
          event: 'notification.failed',
          user: reader,
          error: errorMessage(error),
        });
      }
    }
    await step.do('backfill recent editions', async () => {
      await backfillRecent(db, this.env, 7);
    });
    const readers = await step.do('list readers', () =>
      new Repository(db).readerIds(),
    );
    let issues = 0;
    for (const reader of readers) {
      try {
        await step.do(`lay out issue for user ${reader}`, AI_STEP, () =>
          publishIssue(db, this.env, reader, edition),
        );
        issues++;
      } catch (error) {
        logError({
          event: 'issue.failed',
          user: reader,
          error: errorMessage(error),
        });
        continue;
      }
      try {
        await step.do(`notify user ${reader}`, () =>
          sendIssueReady(this.env, db, reader, edition),
        );
      } catch (error) {
        logError({
          event: 'push.failed',
          user: reader,
          error: errorMessage(error),
        });
      }
    }
    const papers = await step.do('list custom editions', () =>
      new Repository(db).allCustomEditions(),
    );
    for (const paper of papers) {
      try {
        await step.do(`lay out issue for edition ${paper.id}`, AI_STEP, () =>
          publishEditionIssue(db, this.env, paper, edition),
        );
        issues++;
      } catch (error) {
        logError({
          event: 'issue.failed',
          edition: paper.id,
          error: errorMessage(error),
        });
      }
    }
    logInfo({
      event: 'scrape.completed',
      edition,
      sources: sources.length,
      ok,
      articles,
      clusters: clustered.clusters,
      issues,
    });
    return { sources: sources.length, ok, articles };
  }
}

/**
 * The handlers this app adds to the Worker, besides `fetch`.
 *
 * `scheduled` runs every five minutes and starts a {@link DailyScrape} run:
 * a fetch of the sources that are due, or at 06:00 UTC the whole pipeline,
 * which also clusters the edition, backfills missing recent days for the HN
 * feeds from real historical HN data (Algolia) and lays out the issues.
 */
const extraHandlers: Partial<ExportedHandler<CloudflareEnv>> = {
  async scheduled(event, env) {
    try {
      const fetchOnly = !isDailyRun(event.scheduledTime);
      const run = await env.DAILY_SCRAPE.create({ params: { fetchOnly } });
      logInfo({ event: 'scrape.started', run: run.id, fetchOnly });
    } catch (error) {
      logError({ event: 'scrape.failed', error: errorMessage(error) });
    }
  },
};

export default extraHandlers;
