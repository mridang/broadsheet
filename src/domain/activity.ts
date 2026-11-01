/**
 * @packageDocumentation
 *
 * Noting the day a person last used the app, so notifications stop for
 * anyone away for months (as NewsBlur stops them after 90 days). A signed-in
 * API call notes it, after the response, and at most once a day per person in
 * each Worker isolate, so reading the paper does not cost a write a request.
 */

import { getDatabase, type Database } from '@/domain/db/database';
import { NotificationRepository } from '@/domain/notifications';
import { runInBackground } from '@/lib/core/runtime';

/** The day each person was last noted in this isolate. */
const noted = new Map<number, string>();

/** Today, UTC, as YYYY-MM-DD. */
const today = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Note that the person used the app today, unless this isolate already did.
 * True when it wrote.
 */
export async function noteActivity(
  db: Database,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const day = today(now);
  if (noted.get(userId) === day) return false;
  noted.set(userId, day);
  await new NotificationRepository(db).noteSeen(userId, day);
  return true;
}

/** Note the person's activity after the response has gone. */
export function noteActivityLater(userId: number): void {
  runInBackground(
    Promise.resolve().then(() => noteActivity(getDatabase(), userId)),
  );
}
