import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import {
  PROMPT_MODEL,
  promptQuestion,
  readAnswer,
  scorePrompts,
} from '@/domain/prompts';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

const DAY = '2026-11-01';

const item = (n: number): ScrapedItem => ({
  url: `https://x.test/${n}`,
  title: `Story ${n}`,
  source: 'X',
  favicon: '',
  summary: n % 2 ? 'About Rust' : 'About cats',
  image: '',
  published_at: '',
  points: 0,
});

/** An env whose model says yes when the question mentions Rust. */
const ai = (answer?: (q: string) => unknown) => {
  const run = jest.fn(async (_model: string, input: unknown) => {
    const q = (input as { messages: { content: string }[] }).messages[1]!
      .content;
    if (answer) return answer(q);
    return { response: q.includes('Rust') ? 'Yes.' : 'No' };
  });
  return { env: { AI: { run } } as unknown as CloudflareEnv, run };
};

let repo: Repository;
let uid: number;
let feedId: number;

beforeEach(async () => {
  repo = new Repository(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
  uid = (await repo.upsertUser({ sub: 'g', email: 'a@b.c' })).id;
  const feed = (await repo.addFeed(uid, 'https://x.test/rss', 'X'))!;
  feedId = feed.id;
  await repo.writeEdition(feed.source_id, DAY, [item(1), item(2)]);
});

describe('promptQuestion', () => {
  it('names what the reader asked for and the story', () => {
    const q = promptQuestion('rust news', { title: 'T', summary: 'S' });
    expect(q).toContain('rust news');
    expect(q).toContain('T\nS');
  });

  it('sends at most 600 characters of the summary', () => {
    const q = promptQuestion('p', { title: '', summary: 'x'.repeat(900) });
    expect(q).toContain('x'.repeat(600));
    expect(q).not.toContain('x'.repeat(601));
  });
});

describe('readAnswer', () => {
  it.each([
    [{ response: 'Yes' }, true],
    [{ response: ' yes, it does' }, true],
    [{ response: 'No.' }, false],
    [{ response: 'Maybe' }, undefined],
    [{}, undefined],
    [null, undefined],
  ])('reads %j as %j', (out, matched) => {
    expect(readAnswer(out)).toBe(matched);
  });
});

describe('scorePrompts', () => {
  it('asks nothing without prompt classifiers', async () => {
    const { env, run } = ai();
    expect(await scorePrompts(env, repo, uid, DAY)).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('asks the model about each story and keeps the matches', async () => {
    const { env, run } = ai();
    const { classifier } = await repo.addClassifier(uid, {
      kind: 'prompt',
      value: 'systems languages',
      score: 1,
    });
    expect(await scorePrompts(env, repo, uid, DAY)).toBe(2);
    expect(run).toHaveBeenCalledWith(PROMPT_MODEL, expect.anything());
    const matches = await repo.promptMatches(uid);
    expect([...matches.values()]).toEqual([new Set([classifier.id])]);
  });

  it('asks about a story once', async () => {
    const { env, run } = ai();
    await repo.addClassifier(uid, { kind: 'prompt', value: 'p', score: 1 });
    await scorePrompts(env, repo, uid, DAY);
    run.mockClear();
    expect(await scorePrompts(env, repo, uid, DAY)).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('asks again about a story the model gave no answer for', async () => {
    await repo.addClassifier(uid, { kind: 'prompt', value: 'p', score: 1 });
    await scorePrompts(ai(() => ({ response: '?' })).env, repo, uid, DAY);
    expect(await scorePrompts(ai().env, repo, uid, DAY)).toBe(2);
  });

  it('keeps going when the model fails', async () => {
    await repo.addClassifier(uid, { kind: 'prompt', value: 'p', score: 1 });
    const { env } = ai(() => {
      throw new Error('down');
    });
    expect(await scorePrompts(env, repo, uid, DAY)).toBe(2);
    expect((await repo.promptMatches(uid)).size).toBe(0);
  });

  it('asks nothing about stories outside the prompt’s feed', async () => {
    const { env, run } = ai();
    await repo.addClassifier(uid, {
      kind: 'prompt',
      value: 'p',
      score: 1,
      scope_feed_id: feedId + 1,
    });
    expect(await scorePrompts(env, repo, uid, DAY)).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('stops at the daily budget', async () => {
    for (let i = 0; i < 499; i++) await repo.recordUsage(uid, 'classifier');
    await repo.addClassifier(uid, { kind: 'prompt', value: 'p', score: 1 });
    expect(await scorePrompts(ai().env, repo, uid, DAY)).toBe(1);
  });
});
