import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  bumpSessionEpoch,
  getSessionEpoch,
  getUserById,
  upsertGoogleUser,
} from '../../../src/lib/auth/store';
import { APP_MIGRATIONS } from '../db/migrations';
import { installCloudflareContext, sqliteD1 } from '../db/sqlite-d1';

let restore: () => void;

beforeEach(() => {
  restore = installCloudflareContext(sqliteD1(...APP_MIGRATIONS).d1);
});

afterEach(() => restore());

describe('upsertGoogleUser', () => {
  it('creates the person on first sign-in, keyed by their Google account', async () => {
    const user = await upsertGoogleUser({
      sub: 'g1',
      email: 'ada@example.com',
      name: 'Ada',
      picture: 'https://pics.example/ada',
    });
    expect(user).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada',
      picture: 'https://pics.example/ada',
      google_sub: 'g1',
      session_epoch: 0,
    });
  });

  it('recognises a returning person by their Google id, keeping their epoch', async () => {
    const first = await upsertGoogleUser({
      sub: 'g1',
      email: 'old@example.com',
    });
    await bumpSessionEpoch(first.id);
    const again = await upsertGoogleUser({
      sub: 'g1',
      email: 'new@example.com',
    });
    expect(again).toMatchObject({
      id: first.id,
      email: 'new@example.com',
      session_epoch: 1,
    });
  });
});

describe('getUserById, getSessionEpoch and bumpSessionEpoch', () => {
  it('find the person, read their epoch and move it on', async () => {
    const { id } = await upsertGoogleUser({ sub: 'g1', email: 'a@b.com' });
    expect((await getUserById(id))?.email).toBe('a@b.com');
    expect(await getSessionEpoch(id)).toBe(0);
    await bumpSessionEpoch(id);
    expect(await getSessionEpoch(id)).toBe(1);
  });

  it('say nothing for an account that is gone', async () => {
    expect(await getUserById(99)).toBeUndefined();
    expect(await getSessionEpoch(99)).toBeUndefined();
  });
});
