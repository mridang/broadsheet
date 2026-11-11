import { describe, expect, it } from '@jest/globals';

import { cn } from '@/components/ui/cn';

describe('cn', () => {
  it('joins class names with a space', () => {
    // eslint-disable-next-line tailwindcss/no-custom-classname -- fixture class names that are not Tailwind classes.
    expect(cn('a', 'b')).toBe('a b');
  });

  it('skips anything falsy, so a condition can switch a class on', () => {
    const on = true as boolean;
    const off = false as boolean;
    // eslint-disable-next-line tailwindcss/no-custom-classname -- fixture class names that are not Tailwind classes.
    expect(cn('a', on && 'b', off && 'c', null, undefined, '')).toBe('a b');
  });

  it('is empty when there is nothing to join', () => {
    expect(cn()).toBe('');
  });
});
