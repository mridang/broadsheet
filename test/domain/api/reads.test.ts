import { describe, expect, it } from '@jest/globals';

import {
  MAX_BULK_READS,
  parseReadScope,
  parseReadTime,
} from '@/domain/api/reads';

describe('parseReadScope', () => {
  it('reads string article ids', () => {
    expect(parseReadScope({ article_ids: ['1', '22'] })).toEqual({
      ok: true,
      scope: { article_ids: [1, 22] },
    });
  });

  it('takes every member', () => {
    expect(
      parseReadScope({
        article_ids: ['1', '2'],
        feed_ids: ['3'],
        section_id: '4',
        edition: '2026-11-01',
        before: '2026-11-01T00:00:00Z',
        after: '2026-10-01T00:00:00+02:00',
      }),
    ).toEqual({
      ok: true,
      scope: {
        article_ids: [1, 2],
        feed_ids: [3],
        section_id: 4,
        edition: '2026-11-01',
        before: new Date('2026-11-01T00:00:00Z'),
        after: new Date('2026-09-30T22:00:00Z'),
      },
    });
  });

  it('refuses a scope that names nothing', () => {
    expect(parseReadScope({})).toEqual({
      ok: false,
      errors: [
        'A read scope names at least one of article_ids, feed_ids, section_id, edition, before, after; send before as now to mark everything read.',
      ],
    });
  });

  it.each([
    [
      { article_ids: [] },
      `article_ids: must be a list of 1 to ${MAX_BULK_READS} ids.`,
    ],
    [
      { article_ids: [3] },
      `article_ids: must be a list of 1 to ${MAX_BULK_READS} ids.`,
    ],
    [
      { article_ids: ['abc'] },
      `article_ids: must be a list of 1 to ${MAX_BULK_READS} ids.`,
    ],
    [
      {
        article_ids: Array.from(
          { length: MAX_BULK_READS + 1 },
          (_, i) => `${i + 1}`,
        ),
      },
      `article_ids: must be a list of 1 to ${MAX_BULK_READS} ids.`,
    ],
    [
      { feed_ids: [1] },
      `feed_ids: must be a list of 1 to ${MAX_BULK_READS} ids.`,
    ],
    [{ section_id: 'x' }, 'section_id: not a section id.'],
    [{ edition: 'yesterday' }, 'edition: must be a YYYY-MM-DD date.'],
    [{ before: '2026-11-01' }, 'before: must be an RFC 3339 time.'],
    [{ after: 'soon' }, 'after: must be an RFC 3339 time.'],
    [{ days: 3 }, 'days: not a member of a read scope.'],
  ])('refuses %j', (body, error) => {
    expect(parseReadScope(body)).toEqual({ ok: false, errors: [error] });
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
