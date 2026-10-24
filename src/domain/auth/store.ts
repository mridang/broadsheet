/**
 * @packageDocumentation
 *
 * How the shared sign-in code reaches this app's users table: find or create a
 * person by their Google account, load one by id, and read or bump the session
 * epoch. Every app has this module with the same exports; the rest of the
 * sign-in code never touches the database itself.
 */

import { Repository, type Profile, type User } from '@/domain/repository';
import { getDatabase } from '@/core/runtime';

export type { User };

/** What Google tells us about a person who has just signed in. */
export type GoogleProfile = Profile;

/** The repository bound to the current request's database. */
function repo(): Repository {
  return new Repository(getDatabase());
}

/** Find the person by their Google account, creating them on first sign-in and refreshing their profile on return. */
export function upsertGoogleUser(
  profile: Readonly<GoogleProfile>,
): Promise<User> {
  return repo().upsertUser(profile);
}

/** The person with this id, or undefined when there is none. */
export function getUserById(id: number): Promise<User | undefined> {
  return repo().getUser(id);
}

/** The epoch the person's sessions must carry, or undefined when the account is gone. */
export function getSessionEpoch(id: number): Promise<number | undefined> {
  return repo().getSessionEpoch(id);
}

/** End every session the person has, on every device. */
export function bumpSessionEpoch(id: number): Promise<void> {
  return repo().bumpSessionEpoch(id);
}
