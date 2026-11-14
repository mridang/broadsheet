import { describe, expect, it } from '@jest/globals';

import {
  canonicalArguments,
  limitArg,
  numberArg,
  offsetArg,
  stringArg,
  stringListArg,
} from '@/lib/mcp';

describe('stringArg', () => {
  it('trims a string and gives empty for anything else', () => {
    expect(stringArg('  hi ')).toBe('hi');
    expect(stringArg(undefined)).toBe('');
    expect(stringArg(5)).toBe('');
    expect(stringArg(null)).toBe('');
  });
});

describe('stringListArg', () => {
  it('takes one value or a list, splitting commas and dropping blanks', () => {
    expect(stringListArg('a, b')).toEqual(['a', 'b']);
    expect(stringListArg(['a', ' ', 'b,c'])).toEqual(['a', 'b', 'c']);
    expect(stringListArg(undefined)).toEqual([]);
  });

  it('counts numbers as strings and ignores other kinds of value', () => {
    expect(stringListArg([5, true, null, {}, 'x'])).toEqual(['5', 'x']);
  });
});

describe('numberArg', () => {
  it('accepts numbers and numeric strings only', () => {
    expect(numberArg(5)).toBe(5);
    expect(numberArg(' 7 ')).toBe(7);
    expect(numberArg('')).toBeUndefined();
    expect(numberArg('abc')).toBeUndefined();
    expect(numberArg(Infinity)).toBeUndefined();
    expect(numberArg(null)).toBeUndefined();
  });
});

describe('limitArg', () => {
  it('defaults to 12 and keeps the limit between 1 and 50', () => {
    expect(limitArg(undefined)).toBe(12);
    expect(limitArg(0)).toBe(1);
    expect(limitArg(-4)).toBe(1);
    expect(limitArg(500)).toBe(50);
    expect(limitArg('7')).toBe(7);
  });

  it('rounds down to a whole number', () => {
    expect(limitArg(2.9)).toBe(2);
  });
});

describe('offsetArg', () => {
  it('defaults to the start and never goes below it', () => {
    expect(offsetArg(undefined)).toBe(0);
    expect(offsetArg(-5)).toBe(0);
    expect(offsetArg('abc')).toBe(0);
    expect(offsetArg(null)).toBe(0);
  });

  it('rounds down to a whole number', () => {
    expect(offsetArg(12)).toBe(12);
    expect(offsetArg('24')).toBe(24);
    expect(offsetArg(2.9)).toBe(2);
  });
});

describe('canonicalArguments', () => {
  it('keeps every argument as it is when the tool forgives nothing', () => {
    expect(canonicalArguments({ limit: 3, cursor: 'x' })).toEqual({
      limit: 3,
      cursor: 'x',
    });
  });

  it('renames an argument the tool knows by a looser name', () => {
    expect(
      canonicalArguments({ name: 'pie' }, { aliases: { name: 'recipe' } }),
    ).toEqual({ recipe: 'pie' });
  });

  it('leaves both alone when the call sends an alias and its canonical name', () => {
    expect(
      canonicalArguments(
        { name: 'pie', recipe: 'tart' },
        { aliases: { name: 'recipe' } },
      ),
    ).toEqual({ name: 'pie', recipe: 'tart' });
  });

  it('renames nothing the tool did not name, even a well-known slip', () => {
    expect(
      canonicalArguments({ diet: 'vegan' }, { aliases: { name: 'recipe' } }),
    ).toEqual({ diet: 'vegan' });
  });

  it('wraps one piece of text into the list the tool declared', () => {
    expect(
      canonicalArguments(
        { ingredients: '3 tomatoes and pasta' },
        { listsOfText: ['ingredients'] },
      ),
    ).toEqual({ ingredients: ['3 tomatoes and pasta'] });
  });

  it('leaves a list that is already a list, and any other value, for the check to judge', () => {
    expect(
      canonicalArguments(
        { ingredients: ['a'], limit: '5' },
        { listsOfText: ['ingredients'] },
      ),
    ).toEqual({ ingredients: ['a'], limit: '5' });
  });

  it('renames before wrapping, so an alias of a list argument is wrapped too', () => {
    expect(
      canonicalArguments(
        { items: 'tomatoes' },
        { aliases: { items: 'ingredients' }, listsOfText: ['ingredients'] },
      ),
    ).toEqual({ ingredients: ['tomatoes'] });
  });

  it('carries a key called __proto__ as an ordinary property', () => {
    const args = JSON.parse('{"__proto__": 1, "name": "x"}') as Record<
      string,
      unknown
    >;
    const result = canonicalArguments(args);
    expect(Object.keys(result).toSorted((a, b) => a.localeCompare(b))).toEqual([
      '__proto__',
      'name',
    ]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
