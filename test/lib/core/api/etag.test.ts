import { describe, expect, it } from '@jest/globals';

import { entityTag, ifMatchSatisfied, ifNoneMatchHit } from '@/lib/core/api';

describe('entityTag', () => {
  it('is a quoted 16-hex-digit tag that changes with the content', async () => {
    const a = await entityTag('one');
    const b = await entityTag('two');
    expect(a).toMatch(/^"[0-9a-f]{16}"$/);
    expect(a).not.toBe(b);
    expect(await entityTag('one')).toBe(a);
  });
});

describe('ifMatchSatisfied', () => {
  it('allows the write when the header is absent', () => {
    expect(ifMatchSatisfied(null, '"abc"')).toBe(true);
  });

  it('allows it for a matching tag, a wildcard, or ignoring a weak marker', () => {
    expect(ifMatchSatisfied('"abc"', '"abc"')).toBe(true);
    expect(ifMatchSatisfied('*', '"abc"')).toBe(true);
    expect(ifMatchSatisfied('W/"abc"', '"abc"')).toBe(true);
    expect(ifMatchSatisfied('"x", "abc"', '"abc"')).toBe(true);
  });

  it('refuses it when no tag matches', () => {
    expect(ifMatchSatisfied('"x"', '"abc"')).toBe(false);
  });
});

describe('ifNoneMatchHit', () => {
  it('is false when the header is absent', () => {
    expect(ifNoneMatchHit(null, '"abc"')).toBe(false);
  });

  it('is true for a matching tag or a wildcard', () => {
    expect(ifNoneMatchHit('"abc"', '"abc"')).toBe(true);
    expect(ifNoneMatchHit('*', '"abc"')).toBe(true);
  });

  it('is false when nothing matches', () => {
    expect(ifNoneMatchHit('"x"', '"abc"')).toBe(false);
  });
});
