import { describe, expect, it } from '@jest/globals';

import { MAX_BULK_READS, parseBulkReads } from '@/domain/api/reads';

describe('parseBulkReads', () => {
  it('reads string ids', () => {
    expect(parseBulkReads({ article_ids: ['1', '22'] })).toEqual({
      ok: true,
      ids: [1, 22],
    });
  });

  it.each([
    [{}, 'article_ids must be a non-empty array.'],
    [{ article_ids: [] }, 'article_ids must be a non-empty array.'],
    [{ article_ids: [3] }, 'Each article id must be a string id.'],
    [{ article_ids: ['abc'] }, 'Each article id must be a string id.'],
  ])('refuses %j', (body, error) => {
    expect(parseBulkReads(body)).toEqual({ ok: false, error });
  });

  it('refuses more ids than an edition holds', () => {
    const ids = Array.from(
      { length: MAX_BULK_READS + 1 },
      (_, i) => `${i + 1}`,
    );
    expect(parseBulkReads({ article_ids: ids })).toEqual({
      ok: false,
      error: `article_ids may hold at most ${MAX_BULK_READS} ids.`,
    });
  });
});
