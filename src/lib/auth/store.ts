/**
 * @packageDocumentation
 *
 * How the shared sign-in code reaches this app's users table: find or create a
 * person by their Google account, load one by id, and read or bump the session
 * epoch. Every app has this module with the same exports; the rest of the
 * sign-in code never touches the database itself.
 */

import {
  bumpSessionEpoch as bumpEpoch,
  getSessionEpoch as readEpoch,
  getUser,
  upsertUser,
  type Profile,
  type User,
} from '../repository';
import { getDatabase } from '../util';

export type { User };

/** What Google tells us about a person who has just signed in. */
export type GoogleProfile = Profile;

/** Find the person by their Google account, creating them on first sign-in and refreshing their profile on return. */
export function upsertGoogleUser(
  profile: Readonly<GoogleProfile>,
): Promise<User> {
  return upsertUser(getDatabase(), profile);
}

/** The person with this id, or undefined when there is none. */
export function getUserById(id: number): Promise<User | undefined> {
  return getUser(getDatabase(), id);
}

/** The epoch the person's sessions must carry, or undefined when the account is gone. */
export function getSessionEpoch(id: number): Promise<number | undefined> {
  return readEpoch(getDatabase(), id);
}

/** End every session the person has, on every device. */
export function bumpSessionEpoch(id: number): Promise<void> {
  return bumpEpoch(getDatabase(), id);
}
