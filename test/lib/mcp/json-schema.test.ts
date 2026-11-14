import { describe, expect, it } from '@jest/globals';

import {
  describeArguments,
  NOT_BLANK,
  PROBLEMS_SHOWN,
  isJsonObject,
  unsupportedKeywords,
  validateJson,
  type JsonSchema,
} from '@/lib/mcp';

/** The problems found, with the subject spelled out as "It". */
const problems = (schema: JsonSchema, value: unknown) =>
  validateJson(schema, value, 'It');

describe('isJsonObject', () => {
  it('accepts plain objects only', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject('text')).toBe(false);
  });
});

describe('type', () => {
  it.each([
    ['string', 'a', 5, 'text', 'a number'],
    ['number', 1.5, '1.5', 'a number', 'text'],
    ['integer', 2, 2.5, 'a whole number', 'a number'],
    ['boolean', false, 0, 'true or false', 'a number'],
    ['array', [], {}, 'a list', 'an object'],
    ['object', {}, [], 'an object', 'a list'],
    ['null', null, 0, 'null', 'a number'],
  ] as const)('%s', (type, good, bad, wanted, got) => {
    expect(problems({ type }, good)).toEqual([]);
    expect(problems({ type }, bad)).toEqual([
      `It must be ${wanted}, not ${got}.`,
    ]);
  });

  it('describes null, lists and objects as what they are', () => {
    expect(problems({ type: 'string' }, null)).toEqual([
      'It must be text, not null.',
    ]);
    expect(problems({ type: 'string' }, [])).toEqual([
      'It must be text, not a list.',
    ]);
    expect(problems({ type: 'string' }, {})).toEqual([
      'It must be text, not an object.',
    ]);
    expect(problems({ type: 'string' }, true)).toEqual([
      'It must be text, not true or false.',
    ]);
  });

  it('accepts any of several types', () => {
    const schema: JsonSchema = { type: ['string', 'number'] };
    expect(problems(schema, 'a')).toEqual([]);
    expect(problems(schema, 1)).toEqual([]);
    expect(problems(schema, true)).toEqual([
      'It must be text or a number, not true or false.',
    ]);
  });

  it('puts no constraint on a value when no type is given', () => {
    expect(problems({}, { anything: [1] })).toEqual([]);
  });
});

describe('enum and const', () => {
  it('lists the allowed values', () => {
    const schema: JsonSchema = { enum: ['a', 'b'] };
    expect(problems(schema, 'a')).toEqual([]);
    expect(problems(schema, 'c')).toEqual(['It must be one of: a, b.']);
  });

  it('requires the one value', () => {
    expect(problems({ const: 'a' }, 'a')).toEqual([]);
    expect(problems({ const: 'a' }, 'b')).toEqual(['It must be "a".']);
  });
});

describe('strings', () => {
  it('bounds the length in characters, counting each emoji once', () => {
    const schema: JsonSchema = { type: 'string', minLength: 2, maxLength: 3 };
    expect(problems(schema, 'ab')).toEqual([]);
    expect(problems(schema, '😀😀😀')).toEqual([]);
    expect(problems(schema, 'a')).toEqual([
      'It must be at least 2 characters long.',
    ]);
    expect(problems(schema, 'abcd')).toEqual([
      'It must be at most 3 characters long (it is 4).',
    ]);
    expect(problems({ minLength: 1 }, '')).toEqual([
      'It must be at least 1 character long.',
    ]);
  });

  it('matches a pattern anywhere in the text', () => {
    const schema: JsonSchema = { pattern: '^https?://' };
    expect(problems(schema, 'https://example.com')).toEqual([]);
    expect(problems(schema, 'ftp://example.com')).toEqual([
      'It must match the pattern ^https?://.',
    ]);
  });

  it('calls text with only whitespace blank', () => {
    const schema: JsonSchema = { type: 'string', pattern: NOT_BLANK };
    expect(problems(schema, ' a ')).toEqual([]);
    expect(problems(schema, '')).toEqual(['It must not be blank.']);
    expect(problems(schema, ' \n\t ')).toEqual(['It must not be blank.']);
  });
});

describe('numbers', () => {
  it('bounds the value, inclusively', () => {
    const schema: JsonSchema = { type: 'integer', minimum: 1, maximum: 50 };
    expect(problems(schema, 1)).toEqual([]);
    expect(problems(schema, 50)).toEqual([]);
    expect(problems(schema, 0)).toEqual(['It must be at least 1 (it is 0).']);
    expect(problems(schema, 51)).toEqual(['It must be at most 50 (it is 51).']);
  });
});

describe('lists', () => {
  const schema: JsonSchema = {
    type: 'array',
    minItems: 1,
    maxItems: 2,
    items: { type: 'string' },
  };

  it('bounds the length', () => {
    expect(problems(schema, ['a'])).toEqual([]);
    expect(problems(schema, [])).toEqual(['It must have at least 1 item.']);
    expect(problems(schema, ['a', 'b', 'c'])).toEqual([
      'It must have at most 2 items (it has 3).',
    ]);
  });

  it('checks each entry and says which one is wrong', () => {
    expect(problems(schema, ['a', 5])).toEqual([
      '`[1]` must be text, not a number.',
    ]);
  });
});

describe('objects', () => {
  const schema: JsonSchema = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: {
      a: { type: 'string' },
      b: {
        type: 'object',
        properties: { c: { type: 'array', items: { type: 'integer' } } },
      },
    },
  };

  it('accepts a value that fits', () => {
    expect(problems(schema, { a: 'x', b: { c: [1] } })).toEqual([]);
  });

  it('names a missing required property, also when it is undefined', () => {
    let unset: unknown;
    expect(problems(schema, {})).toEqual(['`a` is required.']);
    expect(problems(schema, { a: unset })).toEqual(['`a` is required.']);
  });

  it('names an unknown property and lists the known ones', () => {
    expect(problems(schema, { a: 'x', z: 1 })).toEqual([
      '`z` is not an argument of this tool (it accepts: a, b).',
    ]);
    expect(problems({ additionalProperties: false }, { z: 1 })).toEqual([
      '`z` is not an argument of this tool (it accepts: none).',
    ]);
  });

  it('names several unknown properties in one sentence, and the known ones once', () => {
    expect(problems(schema, { a: 'x', y: 1, z: 1 })).toEqual([
      '`y`, `z` are not arguments of this tool (it accepts: a, b).',
    ]);
  });

  it('spells out only the first few unknown properties and counts the rest', () => {
    const many = Object.fromEntries(
      Array.from({ length: 50_000 }, (_, i) => [`k${i}`, 1]),
    );
    const found = problems(schema, { a: 'x', ...many });
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(
      '`k0`, `k1`, `k2`, `k3`, `k4` and 49995 more are not arguments of this tool (it accepts: a, b).',
    );
  });

  it('quotes only the start of an absurdly long property name', () => {
    const [found] = problems(schema, { a: 'x', ['q'.repeat(100_000)]: 1 });
    expect(found?.length).toBeLessThan(150);
    expect(found).toContain('…');
  });

  it('allows unknown properties unless told not to', () => {
    expect(problems({ type: 'object' }, { z: 1 })).toEqual([]);
  });

  it('finds problems deep inside, with the path to them', () => {
    expect(problems(schema, { a: 'x', b: { c: [1, 'two'] } })).toEqual([
      '`b.c[1]` must be a whole number, not text.',
    ]);
  });

  it('does not mistake an inherited name for a property', () => {
    expect(problems(schema, { a: 'x', constructor: 1 })).toEqual([
      '`constructor` is not an argument of this tool (it accepts: a, b).',
    ]);
    expect(problems({ required: ['toString'] }, {})).toEqual([
      '`toString` is required.',
    ]);
  });

  it('reports every problem, not just the first', () => {
    expect(problems(schema, { z: 1, b: 5 })).toEqual([
      '`a` is required.',
      '`z` is not an argument of this tool (it accepts: a, b).',
      '`b` must be an object, not a number.',
    ]);
  });

  it('refers to the value itself by the name it was given', () => {
    expect(validateJson({ type: 'object' }, 5, 'The arguments')).toEqual([
      'The arguments must be an object, not a number.',
    ]);
    expect(validateJson({ type: 'object' }, 5)).toEqual([
      'The value must be an object, not a number.',
    ]);
  });
});

describe('how many problems are reported', () => {
  it('spells out at most the first few and counts the rest', () => {
    const schema: JsonSchema = {
      type: 'array',
      items: { type: 'string', maxLength: 1 },
    };
    const found = problems(
      schema,
      Array.from({ length: 5000 }, () => 'long'),
    );
    expect(found).toHaveLength(PROBLEMS_SHOWN + 1);
    expect(found.at(-1)).toBe(`…and ${5000 - PROBLEMS_SHOWN} more problems.`);
  });

  it('reports exactly the limit without a trailer', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'integer' } };
    const found = problems(
      schema,
      Array.from({ length: PROBLEMS_SHOWN }, () => 'x'),
    );
    expect(found).toHaveLength(PROBLEMS_SHOWN);
    expect(found.at(-1)).not.toContain('more problems');
  });
});

describe('numbers that are not numbers a schema can mean', () => {
  it('calls an infinite value out of range, not just a number', () => {
    expect(
      problems({ type: 'integer' }, JSON.parse('1e400') as unknown),
    ).toEqual(['It must be a whole number, not an out-of-range number.']);
  });
});

describe('anyOf', () => {
  const schema: JsonSchema = {
    anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }],
  };

  it('accepts a value that fits any branch', () => {
    expect(problems(schema, 'a')).toEqual([]);
    expect(problems(schema, 3)).toEqual([]);
  });

  it('says why each branch refused a value that fits none', () => {
    expect(problems(schema, -1)).toEqual([
      'It matches none of the accepted forms: It must be text, not a number. or It must be at least 0 (it is -1).',
    ]);
  });
});

describe('unsupportedKeywords', () => {
  it('is empty for a schema that uses only checked keywords and annotations', () => {
    expect(
      unsupportedKeywords({
        type: 'object',
        description: 'x',
        required: ['a'],
        properties: {
          // A property may be called anything, including a keyword.
          pattern: { type: 'string', pattern: 'x', default: 'y' },
          list: {
            type: 'array',
            items: { anyOf: [{ type: 'string', enum: ['a'] }] },
          },
        },
      }),
    ).toEqual([]);
  });

  it('finds keywords that would be silently ignored, wherever they are', () => {
    expect(
      unsupportedKeywords({
        type: 'object',
        format: 'uri',
        properties: {
          a: { type: 'array', items: { oneOf: [], uniqueItems: true } },
          b: { anyOf: [{ $ref: '#/x' }] },
        },
      }),
    ).toEqual(['format', 'oneOf', 'uniqueItems', '$ref']);
  });

  it('has nothing to say about a value that is not a schema', () => {
    expect(unsupportedKeywords(5)).toEqual([]);
    expect(unsupportedKeywords(undefined)).toEqual([]);
  });
});

describe('describeArguments', () => {
  it('names the arguments a tool takes, in the order the schema lists them', () => {
    expect(
      describeArguments({
        type: 'object',
        properties: { limit: { type: 'integer' }, cursor: { type: 'string' } },
      }),
    ).toBe('The arguments are: limit, cursor.');
  });

  it('marks the ones a call must send', () => {
    expect(
      describeArguments({
        type: 'object',
        properties: { recipe: { type: 'string' }, note: { type: 'string' } },
        required: ['recipe'],
      }),
    ).toBe('The arguments are: recipe (required), note.');
  });

  it('says so plainly when a tool takes none', () => {
    expect(describeArguments({ type: 'object', properties: {} })).toBe(
      'This tool takes no arguments.',
    );
  });

  it('says so plainly when a schema declares no properties at all', () => {
    expect(describeArguments({ type: 'object' })).toBe(
      'This tool takes no arguments.',
    );
  });
});
