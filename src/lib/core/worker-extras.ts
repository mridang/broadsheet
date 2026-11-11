/**
 * @packageDocumentation
 *
 * What this app adds to the Worker in `src/worker.ts`, which is the same in
 * every app: handlers besides `fetch` (a cron trigger's `scheduled`), and the
 * Workflow or Durable Object classes the Worker must export by name. This app
 * has a daily cron that starts the {@link DailyScrape} Workflow, and runs
 * large OPML imports in the {@link FeedImportRun} Workflow.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';

import {
  dueSlots,
  writeScheduledBriefing,
  type Slot,
} from '@/domain/briefings';
import { clusterEdition } from '@/domain/clustering';
import type { OpmlFeed } from '@/domain/api/opml';
import { databaseFrom } from '@/domain/db/database';
import { D1OAuthStore } from '@/domain/db/oauth';
import { FeedImportRuns, IMPORT_CHUNK } from '@/domain/feed-import-runs';
import { publishEditionIssue, publishIssue } from '@/domain/issues';
import { NotificationRepository } from '@/domain/notifications';
import {
  notifyNewStories,
  sendBriefingReady,
  sendIssueReady,
} from '@/domain/notify';
import { DEFAULT_PREFERENCES, Repository } from '@/domain/repository';
import {
  FETCH_FAILED,
  backfillRecent,
  refreshSource,
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
    const sources = await step.do('list sources', async () => {
      const due = await new Repository(db).dueSources();
      return due.map(
        ({ id, url, etag, last_modified, last_fetched_at }): Fetchable => ({
          id,
          url,
          etag,
          last_modified,
          last_fetched_at,
        }),
      );
    });
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
      const ids = new Set(feeds);
      for (const id of rules) ids.add(id);
      return [...ids].toSorted((a, b) => a - b);
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

/** One briefing that is due: whose, which slot, and the reader's local date. */
export interface DueBriefing {
  readonly user: number;
  readonly slot: Slot;
  readonly date: string;
}

/**
 * The briefings due at `at` that are not written yet: every reader's slots
 * (by their preferences, the defaults for those who changed none) whose time
 * has come on their own clock.
 */
export async function dueBriefings(
  repo: Repository,
  at: Date,
): Promise<DueBriefing[]> {
  const [readers, prefs] = await Promise.all([
    repo.readerIds(),
    repo.allPreferences(),
  ]);
  const due: DueBriefing[] = [];
  for (const user of readers) {
    for (const { slot, date } of dueSlots(
      prefs.get(user) ?? DEFAULT_PREFERENCES,
      at,
    )) {
      if (!(await repo.findBriefing(user, slot, date))) {
        due.push({ user, slot, date });
      }
    }
  }
  return due;
}

/**
 * Writing the briefings that came due, as a Workflow: each as its own
 * retried step (so one failing model call neither holds up nor reruns the
 * others), skipping one another run wrote meanwhile, and pushing a notice to
 * the reader's browsers when a new one is ready.
 */
export class BriefingRun extends WorkflowEntrypoint<CloudflareEnv> {
  override async run(
    event: Readonly<WorkflowEvent<{ due: DueBriefing[]; at: string }>>,
    step: WorkflowStep,
  ): Promise<{ due: number; written: number }> {
    const db = databaseFrom(this.env.DB);
    const at = new Date(event.payload.at);
    let written = 0;
    for (const { user, slot, date } of event.payload.due) {
      try {
        const done = await step.do(
          `brief user ${user} ${slot} ${date}`,
          AI_STEP,
          async () => {
            if (await new Repository(db).findBriefing(user, slot, date)) {
              return null;
            }
            const { briefing } = await writeScheduledBriefing(
              db,
              this.env,
              user,
              slot,
              date,
              at,
            );
            return briefing && briefing.status === 'complete'
              ? { id: briefing.id, title: briefing.title }
              : null;
          },
        );
        if (!done) continue;
        written++;
        await step.do(`notify user ${user} of briefing ${done.id}`, () =>
          sendBriefingReady(this.env, db, user, done.id, done.title).then(
            () => null,
          ),
        );
      } catch (error) {
        logError({
          event: 'briefing.failed',
          user,
          slot,
          date,
          error: errorMessage(error),
        });
      }
    }
    logInfo({
      event: 'briefings.completed',
      due: event.payload.due.length,
      written,
    });
    return { due: event.payload.due.length, written };
  }
}

/** What an import run is asked to do: follow these entries for this person. */
export interface ImportParams {
  readonly id: string;
  readonly user: number;
  readonly feeds: readonly OpmlFeed[];
}

/** How many of an import's new feeds are fetched as soon as it is done. */
const FIRST_FETCHES = 10;

/**
 * A large OPML import, as a Workflow: the entries are followed
 * {@link IMPORT_CHUNK} at a time, each chunk its own retried step that adds
 * what it did to the import's progress (so a person polling the import sees
 * it move, and a failure reruns one chunk, not the file), then the first few
 * new feeds are fetched so they have stories straight away. An import whose
 * chunk still fails after its retries is marked failed with what it did so
 * far.
 */
export class FeedImportRun extends WorkflowEntrypoint<
  CloudflareEnv,
  ImportParams
> {
  override async run(
    event: Readonly<WorkflowEvent<ImportParams>>,
    step: WorkflowStep,
  ): Promise<{ added: number }> {
    const { id, user, feeds } = event.payload;
    const db = databaseFrom(this.env.DB);
    const runs = new FeedImportRuns(db);
    const added: { id: number; url: string }[] = [];
    try {
      for (let start = 0; start < feeds.length; start += IMPORT_CHUNK) {
        const chunk = feeds.slice(start, start + IMPORT_CHUNK);
        added.push(
          ...(await step.do(`import feeds from ${start}`, FETCH_STEP, () =>
            runs.importChunk(id, user, chunk),
          )),
        );
      }
    } catch (error) {
      await step.do('mark failed', () => runs.finish(id, 'failed'));
      logError({
        event: 'import.failed',
        import: id,
        error: errorMessage(error),
      });
      return { added: added.length };
    }
    await step.do('mark complete', () => runs.finish(id, 'complete'));
    for (const source of added.slice(0, FIRST_FETCHES)) {
      try {
        await step.do(`fetch source ${source.id}`, FETCH_STEP, () =>
          refreshSource(db, this.env, source).then(() => null),
        );
      } catch (error) {
        logError({
          event: 'fetch.failed',
          source: source.id,
          error: errorMessage(error),
        });
      }
    }
    logInfo({ event: 'import.completed', import: id, added: added.length });
    return { added: added.length };
  }
}

/** How long a finished import's progress is kept: a week. */
const IMPORT_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Delete what no longer serves anyone: OAuth codes and tokens past their
 * expiry, and the progress of imports that finished over a week ago.
 */
export async function purgeExpired(
  env: CloudflareEnv,
  at: Date,
): Promise<void> {
  try {
    const db = databaseFrom(env.DB);
    const oauth = await new D1OAuthStore(db).purgeExpired(
      Math.floor(at.getTime() / 1000),
    );
    const imports = await new FeedImportRuns(db).purgeFinished(
      new Date(at.getTime() - IMPORT_KEPT_MS),
    );
    logInfo({ event: 'purge.completed', ...oauth, imports });
  } catch (error) {
    logError({ event: 'purge.failed', error: errorMessage(error) });
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
/** Start a run that writes the briefings due at `at`, if any are. */
async function startBriefings(env: CloudflareEnv, at: Date): Promise<void> {
  try {
    const due = await dueBriefings(new Repository(databaseFrom(env.DB)), at);
    if (due.length === 0) return;
    const run = await env.BRIEFINGS.create({
      params: { due, at: at.toISOString() },
    });
    logInfo({ event: 'briefings.started', run: run.id, due: due.length });
  } catch (error) {
    logError({ event: 'briefings.failed', error: errorMessage(error) });
  }
}

const extraHandlers: Partial<ExportedHandler<CloudflareEnv>> = {
  async scheduled(event, env) {
    try {
      const fetchOnly = !isDailyRun(event.scheduledTime);
      const run = await env.DAILY_SCRAPE.create({ params: { fetchOnly } });
      logInfo({ event: 'scrape.started', run: run.id, fetchOnly });
    } catch (error) {
      logError({ event: 'scrape.failed', error: errorMessage(error) });
    }
    await startBriefings(env, new Date(event.scheduledTime));
    await purgeExpired(env, new Date(event.scheduledTime));
  },
};

export default extraHandlers;
