/**
 * @packageDocumentation
 *
 * What this app does at the edges of the shared sign-in flow (see `sign-in.ts`
 * and the callback route): after someone signs in, and for any ask a Google
 * round trip can be for besides signing in. Every app has this module with the
 * same exports; here, a new reader's default feeds are added when they sign
 * in, and there are no other asks.
 */

import { seedDefaults } from '@/domain/account';
import type { User } from '@/domain/repository';
import type { OtherFlow } from '@/domain/auth/sign-in';

/** What runs once the person is recorded and before their session is issued: give a new reader their default feeds. */
export async function afterSignIn(user: Readonly<User>): Promise<void> {
  await seedDefaults(user.id);
}

/** The asks besides signing in, by the purpose label in their `state` (see `EXTRA_PURPOSES` in `app.ts`). None. */
export const OTHER_FLOWS: Readonly<Partial<Record<string, OtherFlow>>> = {};
