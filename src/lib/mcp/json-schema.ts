import { countOf } from '@/lib/intl';

/**
 * @packageDocumentation
 *
 * A small JSON Schema checker for the arguments of an MCP tool call.
 *
 * The MCP spec says a server must validate every tool input, and each tool
 * already publishes an `inputSchema` for exactly that. The usual library for
 * the job (ajv) builds its checkers with `new Function`, which Cloudflare
 * Workers forbid, so this is a hand-written checker for the part of JSON Schema
 * (the 2020-12 dialect, the MCP default) that our schemas use:
 *
 * - `type`, `enum`, `const`
 * - `properties`, `required`, `additionalProperties: false`
 * - `items`, `minItems`, `maxItems`
 * - `minLength`, `maxLength`, `pattern`
 * - `minimum`, `maximum`
 * - `anyOf`
 *
 * Anything else is either a harmless annotation (`description`, `title`,
 * `default`) or not supported; a test walks every tool schema and fails if one
 * uses a keyword that is neither, so a schema can never quietly go unchecked.
 * A second test checks this checker agrees with ajv on a corpus of inputs.
 *
 * Every function here is pure and returns plain data: the problems found, one
 * sentence each, written so an assistant can read them and fix its call.
 */

/** The JSON types a schema's `type` keyword may name. */
export type JsonType =
  'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/** The part of JSON Schema this module understands (see the file comment). */
export interface JsonSchema {
  readonly type?: JsonType | readonly JsonType[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly JsonSchema[];
  /** Annotations: carried for readers, never checked. */
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
}

/**
 * The `pattern` that means "has at least one character that is not
 * whitespace". A plain `minLength: 1` lets `"   "` through, and a blank name
 * or reference is exactly the input that must be refused early, so schemas use
 * this and the checker words the failure as "must not be blank".
 */
export const NOT_BLANK = String.raw`\S`;

/** Every keyword the checker acts on. */
export const CHECKED_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
]);

/** Keywords that only describe, and so are safe to leave unchecked. */
export const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'default',
  'examples',
]);

/** Whether a value is a JSON object (not an array and not null). */
export function isJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is of the JSON type `type`. */
function hasType(type: JsonType, value: unknown): boolean {
  switch (type) {
    case 'string': {
      return typeof value === 'string';
    }
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value);
    }
    case 'integer': {
      return typeof value === 'number' && Number.isInteger(value);
    }
    case 'boolean': {
      return typeof value === 'boolean';
    }
    case 'array': {
      return Array.isArray(value);
    }
    case 'object': {
      return isJsonObject(value);
    }
    case 'null': {
      return value === null;
    }
  }
}

/** A type as it reads in a sentence: "a whole number", "text". */
function typeWords(type: JsonType): string {
  switch (type) {
    case 'string': {
      return 'text';
    }
    case 'number': {
      return 'a number';
    }
    case 'integer': {
      return 'a whole number';
    }
    case 'boolean': {
      return 'true or false';
    }
    case 'array': {
      return 'a list';
    }
    case 'object': {
      return 'an object';
    }
    case 'null': {
      return 'null';
    }
  }
}

/** What a value actually is, for "must be X, not Y". */
function actualWords(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'a list';
  }
  switch (typeof value) {
    case 'string': {
      return 'text';
    }
    case 'number': {
      // `JSON.parse('1e400')` is Infinity: a number that is not one a schema can mean.
      return Number.isFinite(value) ? 'a number' : 'an out-of-range number';
    }
    case 'boolean': {
      return 'true or false';
    }
    case 'object': {
      return 'an object';
    }
    default: {
      return typeof value;
    }
  }
}

/** Where in the arguments a value sits: `[]` is the arguments themselves. */
type Path = readonly (string | number)[];

/** The longest a property name is quoted in a message; a hostile key can be a megabyte long. */
const NAME_QUOTE_LIMIT = 40;

/** A property name as it is quoted in a message, cut short when it is absurdly long. */
function quotedKey(key: string): string {
  return key.length > NAME_QUOTE_LIMIT
    ? `${key.slice(0, NAME_QUOTE_LIMIT)}…`
    : key;
}

/** The path as a name an assistant can find in its call: `limit`, `images[2]`, `a.b`. */
function nameOf(path: Path, root: string): string {
  if (path.length === 0) {
    return root;
  }
  const text = path.reduce<string>((soFar, part) => {
    if (typeof part === 'number') {
      return `${soFar}[${part}]`;
    }
    return soFar ? `${soFar}.${quotedKey(part)}` : quotedKey(part);
  }, '');
  return `\`${text}\``;
}

/** "1 character", "2 characters". */
function characters(n: number): string {
  return countOf(n, 'character');
}

/** "1 item", "2 items". */
function items(n: number): string {
  return countOf(n, 'item');
}

/** The problems with a string against `minLength`, `maxLength` and `pattern`. */
function stringProblems(
  schema: JsonSchema,
  value: string,
  subject: string,
): readonly string[] {
  // JSON Schema counts characters as code points, not UTF-16 units.
  const length = [...value].length;
  return [
    ...(schema.minLength !== undefined && length < schema.minLength
      ? [`${subject} must be at least ${characters(schema.minLength)} long.`]
      : []),
    ...(schema.maxLength !== undefined && length > schema.maxLength
      ? [
          `${subject} must be at most ${characters(schema.maxLength)} long (it is ${length}).`,
        ]
      : []),
    ...(schema.pattern !== undefined &&
    !new RegExp(schema.pattern, 'u').test(value)
      ? [
          schema.pattern === NOT_BLANK
            ? `${subject} must not be blank.`
            : `${subject} must match the pattern ${schema.pattern}.`,
        ]
      : []),
  ];
}

/** The problems with a number against `minimum` and `maximum`. */
function numberProblems(
  schema: JsonSchema,
  value: number,
  subject: string,
): readonly string[] {
  return [
    ...(schema.minimum !== undefined && value < schema.minimum
      ? [`${subject} must be at least ${schema.minimum} (it is ${value}).`]
      : []),
    ...(schema.maximum !== undefined && value > schema.maximum
      ? [`${subject} must be at most ${schema.maximum} (it is ${value}).`]
      : []),
  ];
}

/** The problems with a list: its length, then each entry against `items`. */
function arrayProblems(
  schema: JsonSchema,
  value: readonly unknown[],
  path: Path,
  root: string,
): readonly string[] {
  const subject = nameOf(path, root);
  return [
    ...(schema.minItems !== undefined && value.length < schema.minItems
      ? [`${subject} must have at least ${items(schema.minItems)}.`]
      : []),
    ...(schema.maxItems !== undefined && value.length > schema.maxItems
      ? [
          `${subject} must have at most ${items(schema.maxItems)} (it has ${value.length}).`,
        ]
      : []),
    ...(schema.items
      ? value.flatMap((entry, index) =>
          problemsAt(schema.items ?? {}, entry, [...path, index], root),
        )
      : []),
  ];
}

/** How many unknown argument names one sentence spells out before it says "and N more". */
const UNKNOWN_NAMES_SHOWN = 5;

/**
 * One sentence for all the keys an object may not have: a few of them by name,
 * the count of the rest, and the accepted names once. One sentence per key would
 * let a request with a hundred thousand keys make a reply of tens of megabytes.
 */
function unknownKeysProblem(
  unknown: readonly string[],
  known: readonly string[],
  path: Path,
  root: string,
): readonly string[] {
  if (unknown.length === 0) {
    return [];
  }
  const shown = unknown
    .slice(0, UNKNOWN_NAMES_SHOWN)
    .map((key) => nameOf([...path, key], root));
  const rest = unknown.length - shown.length;
  const names =
    rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
  return [
    `${names} ${unknown.length === 1 ? 'is not an argument' : 'are not arguments'} of this tool (it accepts: ${known.join(', ') || 'none'}).`,
  ];
}

/** The problems with an object: required keys, unknown keys, then each known key. */
function objectProblems(
  schema: JsonSchema,
  value: Readonly<Record<string, unknown>>,
  path: Path,
  root: string,
): readonly string[] {
  const properties = schema.properties ?? {};
  const known = Object.keys(properties);
  return [
    ...(schema.required ?? [])
      .filter((key) => !Object.hasOwn(value, key) || value[key] === undefined)
      .map((key) => `${nameOf([...path, key], root)} is required.`),
    ...(schema.additionalProperties === false
      ? unknownKeysProblem(
          Object.keys(value).filter((key) => !Object.hasOwn(properties, key)),
          known,
          path,
          root,
        )
      : []),
    ...Object.entries(properties).flatMap(([key, sub]) =>
      Object.hasOwn(value, key) && value[key] !== undefined
        ? problemsAt(sub, value[key], [...path, key], root)
        : [],
    ),
  ];
}

/** The problems with a value against `anyOf`: none if any branch accepts it. */
function anyOfProblems(
  branches: readonly JsonSchema[],
  value: unknown,
  path: Path,
  root: string,
): readonly string[] {
  const attempts = branches.map((branch) =>
    problemsAt(branch, value, path, root),
  );
  return attempts.some((problems) => problems.length === 0)
    ? []
    : [
        `${nameOf(path, root)} matches none of the accepted forms: ${attempts
          .map((problems) => problems.join(' '))
          .join(' or ')}`,
      ];
}

/** The problems with a value against a schema, found at `path`. */
function problemsAt(
  schema: JsonSchema,
  value: unknown,
  path: Path,
  root: string,
): readonly string[] {
  const subject = nameOf(path, root);
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length > 0 && !types.some((type) => hasType(type, value))) {
    return [
      `${subject} must be ${types.map(typeWords).join(' or ')}, not ${actualWords(value)}.`,
    ];
  }
  return [
    ...(schema.enum && !schema.enum.some((option) => Object.is(option, value))
      ? [`${subject} must be one of: ${schema.enum.join(', ')}.`]
      : []),
    ...('const' in schema && !Object.is(schema.const, value)
      ? [`${subject} must be ${JSON.stringify(schema.const)}.`]
      : []),
    ...(typeof value === 'string'
      ? stringProblems(schema, value, subject)
      : []),
    ...(typeof value === 'number'
      ? numberProblems(schema, value, subject)
      : []),
    ...(Array.isArray(value) ? arrayProblems(schema, value, path, root) : []),
    ...(isJsonObject(value) ? objectProblems(schema, value, path, root) : []),
    ...(schema.anyOf ? anyOfProblems(schema.anyOf, value, path, root) : []),
  ];
}

/** The most problems a check reports; the rest are counted, not spelled out. */
export const PROBLEMS_SHOWN = 10;

/**
 * Check `value` against `schema` and say what is wrong with it.
 * @param schema - The schema, in the supported subset (see the file comment).
 * @param value - The parsed JSON to check.
 * @param root - How to refer to the value itself in a message; the arguments of a
 * tool call are "The arguments".
 * @returns One sentence per problem, empty when the value is valid. At most
 * {@link PROBLEMS_SHOWN} are spelled out, then a last sentence says how many
 * more there were, so a hostile request cannot make a reply of any size.
 */
export function validateJson(
  schema: JsonSchema,
  value: unknown,
  root = 'The value',
): readonly string[] {
  const problems = problemsAt(schema, value, [], root);
  return problems.length > PROBLEMS_SHOWN
    ? [
        ...problems.slice(0, PROBLEMS_SHOWN),
        `…and ${problems.length - PROBLEMS_SHOWN} more problems.`,
      ]
    : problems;
}

/**
 * Every keyword used anywhere in a schema that the checker neither acts on nor
 * treats as an annotation. A schema that returns anything here is partly
 * unchecked, so a test requires this to be empty for every tool.
 * @param schema - A schema (anything that is not an object has no keywords).
 */
export function unsupportedKeywords(schema: unknown): readonly string[] {
  if (!isJsonObject(schema)) {
    return [];
  }
  return Object.entries(schema).flatMap(([key, sub]) => {
    const unknown =
      CHECKED_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key) ? [] : [key];
    // Only these three hold further schemas; the rest hold plain values.
    if (key === 'properties' && isJsonObject(sub)) {
      return [
        ...unknown,
        ...Object.values(sub).flatMap((item) => unsupportedKeywords(item)),
      ];
    }
    if (key === 'items') {
      return [...unknown, ...unsupportedKeywords(sub)];
    }
    if (key === 'anyOf' && Array.isArray(sub)) {
      return [...unknown, ...sub.flatMap((item) => unsupportedKeywords(item))];
    }
    return unknown;
  });
}

/**
 * The arguments a schema accepts, as one line an assistant can follow:
 * "The arguments are: limit, cursor." Required ones are marked, so a refusal
 * can say both what was wrong and what the tool takes.
 */
export function describeArguments(schema: JsonSchema): string {
  const required = new Set(schema.required);
  const names = Object.keys(schema.properties ?? {}).map((key) =>
    required.has(key) ? `${key} (required)` : key,
  );
  return names.length > 0
    ? `The arguments are: ${names.join(', ')}.`
    : 'This tool takes no arguments.';
}
