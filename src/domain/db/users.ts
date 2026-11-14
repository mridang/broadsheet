/**
 * @packageDocumentation
 *
 * Reading the person a request is from, under the name the shared OAuth and MCP
 * code asks for, and in the order it calls it.
 */

import { eq } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import { users } from '@/domain/db/schema';

/** One signed-in person, as this app stores them. */
export type User = typeof users.$inferSelect;

/**
 * The person with this internal id, or undefined when there is none.
 * @param db - The database to read.
 * @param id - The internal user id, which only this app's own records carry.
 */
export async function getUserById(
  db: Database,
  id: number,
): Promise<User | undefined> {
  const [found] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return found;
}
