import { beforeEach, describe, expect, it } from '@jest/globals';

import { budget, overBudget } from '@/domain/api/usage';
import { DAILY_LIMITS } from '@/domain/assistant';
import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let repo: Repository;
const now = new Date('2099-01-01T23:00:00Z');

beforeEach(() => {
  repo = new Repository(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
});

/** Note `n` questions of `kind` for person 1, stamped today in `now`'s day. */
async function asked(n: number, kind: 'answer' | 'assistant' = 'answer') {
  for (let i = 0; i < n; i++) await repo.recordUsage(1, kind);
}

describe('budget', () => {
  it('reports what is used and left, and when it resets', async () => {
    await asked(2);
    expect(await budget(repo, 1, 'answer', new Date())).toMatchObject({
      used: 2,
      limit: DAILY_LIMITS.answer,
      remaining: DAILY_LIMITS.answer - 2,
    });
    expect((await budget(repo, 1, 'answer', now)).resets_at).toBe(
      '2099-01-02T00:00:00Z',
    );
  });

  it('counts each kind on its own', async () => {
    await asked(3, 'assistant');
    expect((await budget(repo, 1, 'answer', new Date())).used).toBe(0);
  });
});

describe('overBudget', () => {
  it('lets a person with questions left ask', async () => {
    expect(await overBudget(repo, 1, 'answer', new Date())).toBeUndefined();
  });

  it('answers 429 with Retry-After to the next UTC day when the budget is used up', async () => {
    await asked(DAILY_LIMITS.assistant, 'assistant');
    const at = new Date();
    const res = await overBudget(repo, 1, 'assistant', at);
    expect(res?.status).toBe(429);
    expect(res?.headers.get('content-type')).toBe('application/problem+json');
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res?.json()) as { detail: string }).detail).toContain(
      `all ${DAILY_LIMITS.assistant} assistant questions`,
    );
  });
});
