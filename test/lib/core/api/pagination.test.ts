import { describe, expect, it } from '@jest/globals';

import {
  encodeCursor,
  decodeCursor,
  parseLimit,
  sliceAfter,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type CursorPosition,
} from '@/lib/core/api';

describe('cursor', () => {
  it('round-trips a position through an opaque token', () => {
    const position: CursorPosition = { key: '2024-01-01', id: '42' };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('decodes anything that is not one of our tokens as undefined', () => {
    expect(decodeCursor('not-a-cursor')).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });
});

describe('parseLimit', () => {
  it('falls back when the parameter is absent', () => {
    expect(parseLimit(null)).toBe(DEFAULT_LIMIT);
    expect(parseLimit(null, 5)).toBe(5);
  });

  it('accepts a whole number within range', () => {
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit(String(MAX_LIMIT))).toBe(MAX_LIMIT);
  });

  it('refuses a non-integer, a zero, or an over-limit value with a 400', async () => {
    for (const raw of ['0', '-1', '1.5', 'abc', String(MAX_LIMIT + 1)]) {
      const result = parseLimit(raw);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    }
  });
});

describe('sliceAfter', () => {
  const sorted = [1, 2, 3, 4, 5];
  const positionOf = (n: number): CursorPosition => ({
    key: String(n),
    id: String(n),
  });
  const compare = (a: CursorPosition, b: CursorPosition): number =>
    Number(a.id) - Number(b.id);

  it('returns a full page and the next position when more follow', () => {
    const slice = sliceAfter(sorted, positionOf, compare, undefined, 2);
    expect(slice.items).toEqual([1, 2]);
    expect(slice.next).toEqual(positionOf(2));
  });

  it('starts after the given position', () => {
    const slice = sliceAfter(sorted, positionOf, compare, positionOf(2), 2);
    expect(slice.items).toEqual([3, 4]);
    expect(slice.next).toEqual(positionOf(4));
  });

  it('omits next on the last page', () => {
    const slice = sliceAfter(sorted, positionOf, compare, positionOf(3), 10);
    expect(slice.items).toEqual([4, 5]);
    expect(slice.next).toBeUndefined();
  });
});
