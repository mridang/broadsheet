import { describe, expect, it } from '@jest/globals';

import {
  MAX_BULK_READS,
  parseBulkReads,
  parseReadTime,
} from '@/domain/api/reads';

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

describe('parseReadTime', () => {
  it('takes whole seconds, counting more than twenty minutes as twenty', () => {
    expect(parseReadTime({ seconds: 45 })).toEqual({ ok: true, seconds: 45 });
    expect(parseReadTime({ seconds: 5000 })).toEqual({
      ok: true,
      seconds: 1200,
    });
  });

  it.each([
    [{}, 'seconds: must be a whole number from 0.'],
    [{ seconds: 1.5 }, 'seconds: must be a whole number from 0.'],
    [{ seconds: '4' }, 'seconds: must be a whole number from 0.'],
  ])('refuses %j', (body, error) => {
    expect(parseReadTime(body)).toEqual({ ok: false, errors: [error] });
  });

  it('refuses members a read does not have', () => {
    expect(parseReadTime({ seconds: 4, user_id: 1 })).toEqual({
      ok: false,
      errors: ['user_id: not a member of a read.'],
    });
  });
});
