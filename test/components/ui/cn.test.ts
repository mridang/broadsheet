import { describe, expect, it } from '@jest/globals';

import { cn } from '@/components/ui/cn';

describe('cn', () => {
  it('joins class names with a space', () => {
    expect(cn('p-1', 'm-1')).toBe('p-1 m-1');
  });

  it('skips anything falsy, so a condition can switch a class on', () => {
    const on = true as boolean;
    const off = false as boolean;
    expect(cn('p-1', on && 'm-1', off && 'flex', null, undefined, '')).toBe(
      'p-1 m-1',
    );
  });

  it('is empty when there is nothing to join', () => {
    expect(cn()).toBe('');
  });
});
