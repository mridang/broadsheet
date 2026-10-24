import { describe, expect, it } from '@jest/globals';

import { safeJsonParse } from '@/utils/json';

describe('safeJsonParse', () => {
  it('parses valid JSON into an ok result', () => {
    const result = safeJsonParse<{ a: number }>('{"a":1}');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('parses JSON primitives', () => {
    expect(safeJsonParse<number>('42')).toEqual({ ok: true, value: 42 });
    expect(safeJsonParse<boolean>('true')).toEqual({ ok: true, value: true });
    expect(safeJsonParse<null>('null')).toEqual({ ok: true, value: null });
    expect(safeJsonParse<string>('"hi"')).toEqual({ ok: true, value: 'hi' });
  });

  it('parses arrays', () => {
    expect(safeJsonParse<number[]>('[1,2,3]')).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
  });

  it('returns ok:false with the parser message on invalid JSON', () => {
    const result = safeJsonParse('{not json}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false on an empty string', () => {
    const result = safeJsonParse('');
    expect(result.ok).toBe(false);
  });

  it('produces a discriminated result whose value is only present when ok', () => {
    const result = safeJsonParse<{ a: number }>('{"a":1}');
    if (result.ok) {
      expect(result.value.a).toBe(1);
    } else {
      throw new Error('expected ok result');
    }
  });
});
