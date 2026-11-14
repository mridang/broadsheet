import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/client';
import { EMPTY_PLAYER, PlayerRepository } from '@/domain/player';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let raw: ReturnType<typeof sqliteD1>['raw'];
let repo: PlayerRepository;

beforeEach(() => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  repo = new PlayerRepository(databaseFrom(made.d1));
});

const state = {
  rate: 1.25,
  current: { article_id: 3, position: 40 },
  queue: [4, 5],
  history: [2, 1],
};

describe('PlayerRepository', () => {
  it('gives the empty player to someone who never listened', async () => {
    expect(await repo.get(1)).toEqual(EMPTY_PLAYER);
  });

  it('keeps each person’s player apart', async () => {
    await repo.put(1, state);
    expect(await repo.get(1)).toEqual(state);
    expect(await repo.get(2)).toEqual(EMPTY_PLAYER);
  });

  it('replaces the player on a second put', async () => {
    await repo.put(1, state);
    await repo.put(1, { ...state, current: null, queue: [] });
    expect(await repo.get(1)).toEqual({
      ...state,
      current: null,
      queue: [],
    });
  });

  it('reads a damaged queue as empty', async () => {
    await repo.put(1, state);
    raw
      .prepare("UPDATE players SET queue = 'nope', history = '[1,\"x\"]'")
      .run();
    const got = await repo.get(1);
    expect(got.queue).toEqual([]);
    expect(got.history).toEqual([1]);
  });

  it('clears a player, and says when there was none', async () => {
    await repo.put(1, state);
    expect(await repo.clear(1)).toBe(true);
    expect(await repo.clear(1)).toBe(false);
  });
});
