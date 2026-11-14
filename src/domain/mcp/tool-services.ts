/**
 * @packageDocumentation
 *
 * The outside things this app's tools reach for.
 *
 * They sit behind one interface so that a tool can be tested with fakes instead
 * of a Cloudflare environment, and so that opening the database is something a
 * tool asks for rather than something done for every call.
 */

import type { AnswerModel } from '@/domain/assistant';
import { getDatabase, type Database } from '@/domain/db/database';
import { refreshSource } from '@/domain/scraping/index';

/** What this app's tools reach for. */
export interface ToolServices {
  /** The database, opened when a tool asks for it. */
  readonly openDatabase: () => Database;
  /** Fetch a newly followed feed after the reply is sent. */
  readonly refresh: (source: {
    readonly id: number;
    readonly url: string;
  }) => void;
  /** The model that answers archive questions, when one is bound. */
  readonly model?: AnswerModel;
}

/** The real database, with nothing fetched in the background. */
export const liveToolServices: ToolServices = {
  openDatabase: getDatabase,
  refresh: () => undefined,
};

/** What refreshes a newly followed feed in production. */
export function refresher(
  db: Database,
  env: CloudflareEnv,
  background: (work: Promise<unknown>) => void,
): ToolServices['refresh'] {
  return (source) =>
    background(refreshSource(db, env, source).catch(() => undefined));
}
