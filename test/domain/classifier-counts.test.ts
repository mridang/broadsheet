import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  countVerdicts,
  feedClassifierCounts,
  feedVerdictCounts,
} from '@/domain/classifier-counts';
import { databaseFrom } from '@/domain/db/database';
import type { Training } from '@/domain/render/tiers';
import { Repository, type Article } from '@/domain/repository';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

const training: Training[] = [
  { kind: 'title', value: 'rust', score: 1 },
  { kind: 'title', value: 'cats', score: -1 },
];

describe('countVerdicts', () => {
  it('counts liked, neutral and disliked stories', () => {
    expect(
      countVerdicts(
        ['Rust', 'Go', 'Cats', 'Rust 2'].map((title) => ({
          title,
          source: null,
        })),
        training,
      ),
    ).toEqual({ focus: 2, neutral: 1, hidden: 1 });
  });

  it('counts nothing for no stories', () => {
    expect(countVerdicts([], training)).toEqual({
      focus: 0,
      neutral: 0,
      hidden: 0,
    });
  });
});

describe('feedVerdictCounts', () => {
  it('lets a matched AI prompt decide', () => {
    const story = { id: 3, title: 'Cats', source: null } as Article;
    expect(
      feedVerdictCounts(
        [story],
        { id: 1, section_id: null },
        [...training, { id: 9, kind: 'prompt', value: 'pets', score: 1 }],
        new Map([[3, new Set([9])]]),
      ),
    ).toEqual({ focus: 1, neutral: 0, hidden: 0 });
  });
});

describe('feedClassifierCounts', () => {
  let repo: Repository;

  beforeEach(() => {
    repo = new Repository(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
  });

  it('leaves out the stories the person has read', async () => {
    const user = await repo.upsertUser({ sub: 'g', email: 'a@b.c' });
    const feed = (await repo.addFeed(user.id, 'https://a.test/f'))!;
    await repo.writeEdition(
      feed.source_id,
      '2026-10-02',
      ['Rust', 'Go'].map((title, i) => ({
        url: `https://x/${i}`,
        title,
        source: 'Src',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      })),
    );
    await repo.addClassifier(user.id, {
      kind: 'title',
      value: 'rust',
      score: 1,
    });
    const [rust] = (
      await repo.sourceArticles(feed.source_id, '2026-10-02')
    ).filter((a) => a.title === 'Rust');
    await repo.markRead(user.id, rust!.id);
    expect(await feedClassifierCounts(repo, user.id, feed)).toEqual({
      focus: 0,
      neutral: 1,
      hidden: 0,
    });
  });
});
