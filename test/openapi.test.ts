import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from './lib/core/db/migrations';
import { installCloudflareContext, sqliteD1 } from './lib/core/db/sqlite-d1';
import { FeedImportRuns } from '@/domain/feed-import-runs';
import {
  SESSION_SECRET,
  fakeCookies,
  jar,
  tokenFor,
} from './domain/auth/auth-test-kit';

// The sign-out routes read the session through Next's request cookies.
jest.unstable_mockModule('next/headers', () => ({ cookies: fakeCookies }));

/*
 * openapi.json is the contract of the REST API under /api. This test ties it
 * to the controllers so neither can drift: every route is an operation and
 * every operation a route; every operation says who may call it and the
 * controller agrees; valid and invalid requests end in a documented status,
 * with an RFC 9457 problem for every error; and what the controllers answer
 * fits the schemas of the spec.
 */

type Json = { [key: string]: unknown };
type Handler = (request: Request, context?: unknown) => Promise<Response>;

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema?: Json;
}

interface Operation {
  operationId: string;
  tags: string[];
  summary: string;
  security?: Json[];
  parameters?: Json[];
  requestBody?: Json;
  responses: Record<string, Json>;
}

const spec = JSON.parse(
  // eslint-disable-next-line n/no-sync -- sync is fine in a script or bootstrap
  readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
) as Json & {
  openapi: string;
  info: Json;
  tags: { name: string }[];
  security?: Json[];
  paths: Record<string, Json>;
  components: Record<string, Record<string, Json>>;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** The routes under /api that are kept on purpose and are not in the contract. */
const ALIASES = new Set([
  // The old WebSub callback, kept for hubs subscribed before it moved to
  // /webhooks/sources/{id}.
  'GET /api/sources/{id}/pushes',
  'POST /api/sources/{id}/pushes',
]);

/** The prefixes of everything that is not REST and so is not in the spec. */
const NOT_REST = [
  '/auth',
  '/oauth',
  '/.well-known',
  '/mcp',
  '/webhooks',
  '/events',
  '/img',
  '/health',
  '/feed.xml',
  '/csp',
];

const operations = new Map<string, Operation & { path: string }>();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method] as Operation | undefined;
    if (op) {
      operations.set(`${method.toUpperCase()} ${path}`, { ...op, path });
    }
  }
}

const API = path.join(process.cwd(), 'src/app/api');

const routeFiles = (dir: string): string[] =>
  // eslint-disable-next-line n/no-sync -- sync is fine in a test helper
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return routeFiles(path.join(dir, entry.name));
    }
    return entry.name === 'route.ts' ? [path.join(dir, entry.name)] : [];
  });

/** Every `METHOD /path` a route under src/app/api exports, with its handler. */
const handlers = new Map<string, Handler>();

/**
 * The route modules under src/app/api, loaded on demand. A route added without a
 * line here fails the test below, so none can escape the contract.
 */
const ROUTES: Record<string, () => Promise<Record<string, unknown>>> = {
  'articles/[id]/answers/route': () =>
    import('@/app/api/articles/[id]/answers/route'),
  'articles/[id]/emails/route': () =>
    import('@/app/api/articles/[id]/emails/route'),
  'articles/[id]/extractions/route': () =>
    import('@/app/api/articles/[id]/extractions/route'),
  'articles/[id]/route': () => import('@/app/api/articles/[id]/route'),
  'articles/[id]/similar/route': () =>
    import('@/app/api/articles/[id]/similar/route'),
  'articles/route': () => import('@/app/api/articles/route'),
  'conversations/[id]/messages/route': () =>
    import('@/app/api/conversations/[id]/messages/route'),
  'conversations/[id]/route': () =>
    import('@/app/api/conversations/[id]/route'),
  'conversations/route': () => import('@/app/api/conversations/route'),
  'conversations/suggestions/route': () =>
    import('@/app/api/conversations/suggestions/route'),
  'editions/[id]/issues/[date]/route': () =>
    import('@/app/api/editions/[id]/issues/[date]/route'),
  'editions/[id]/route': () => import('@/app/api/editions/[id]/route'),
  'editions/route': () => import('@/app/api/editions/route'),
  'editions/self/briefings/[id]/route': () =>
    import('@/app/api/editions/self/briefings/[id]/route'),
  'editions/self/briefings/route': () =>
    import('@/app/api/editions/self/briefings/route'),
  'editions/self/issues/[date]/route': () =>
    import('@/app/api/editions/self/issues/[date]/route'),
  'editions/self/issues/route': () =>
    import('@/app/api/editions/self/issues/route'),
  'feeds/[id]/refreshes/route': () =>
    import('@/app/api/feeds/[id]/refreshes/route'),
  'feeds/[id]/route': () => import('@/app/api/feeds/[id]/route'),
  'feeds/[id]/similar/route': () =>
    import('@/app/api/feeds/[id]/similar/route'),
  'feeds/[id]/statistics/route': () =>
    import('@/app/api/feeds/[id]/statistics/route'),
  'feeds/conversions/route': () => import('@/app/api/feeds/conversions/route'),
  'feeds/imports/[id]/route': () =>
    import('@/app/api/feeds/imports/[id]/route'),
  'feeds/imports/route': () => import('@/app/api/feeds/imports/route'),
  'feeds/moves/route': () => import('@/app/api/feeds/moves/route'),
  'feeds/recommendations/[id]/route': () =>
    import('@/app/api/feeds/recommendations/[id]/route'),
  'feeds/recommendations/route': () =>
    import('@/app/api/feeds/recommendations/route'),
  'feeds/refreshes/route': () => import('@/app/api/feeds/refreshes/route'),
  'feeds/removals/route': () => import('@/app/api/feeds/removals/route'),
  'feeds/route': () => import('@/app/api/feeds/route'),
  'feeds/suggestions/route': () => import('@/app/api/feeds/suggestions/route'),
  'feeds/trending/route': () => import('@/app/api/feeds/trending/route'),
  'news/topics/route': () => import('@/app/api/news/topics/route'),
  'podcasts/route': () => import('@/app/api/podcasts/route'),
  'push/configuration/route': () =>
    import('@/app/api/push/configuration/route'),
  'sections/[id]/route': () => import('@/app/api/sections/[id]/route'),
  'sections/route': () => import('@/app/api/sections/route'),
  'sessions/route': () => import('@/app/api/sessions/route'),
  'sessions/self/route': () => import('@/app/api/sessions/self/route'),
  'shares/route': () => import('@/app/api/shares/route'),
  'sources/[id]/pushes/route': () =>
    import('@/app/api/sources/[id]/pushes/route'),
  'sources/route': () => import('@/app/api/sources/route'),
  'topics/route': () => import('@/app/api/topics/route'),
  'transcriptions/route': () => import('@/app/api/transcriptions/route'),
  'users/self/classifiers/[id]/route': () =>
    import('@/app/api/users/self/classifiers/[id]/route'),
  'users/self/classifiers/route': () =>
    import('@/app/api/users/self/classifiers/route'),
  'users/self/notifications/[feed_id]/route': () =>
    import('@/app/api/users/self/notifications/[feed_id]/route'),
  'users/self/notifications/rules/[id]/route': () =>
    import('@/app/api/users/self/notifications/rules/[id]/route'),
  'users/self/notifications/rules/route': () =>
    import('@/app/api/users/self/notifications/rules/route'),
  'users/self/player/route': () => import('@/app/api/users/self/player/route'),
  'users/self/preferences/route': () =>
    import('@/app/api/users/self/preferences/route'),
  'users/self/push/subscriptions/[id]/route': () =>
    import('@/app/api/users/self/push/subscriptions/[id]/route'),
  'users/self/push/subscriptions/route': () =>
    import('@/app/api/users/self/push/subscriptions/route'),
  'users/self/reads/[article_id]/route': () =>
    import('@/app/api/users/self/reads/[article_id]/route'),
  'users/self/reads/route': () => import('@/app/api/users/self/reads/route'),
  'users/self/rivers/[id]/route': () =>
    import('@/app/api/users/self/rivers/[id]/route'),
  'users/self/rivers/route': () => import('@/app/api/users/self/rivers/route'),
  'users/self/saves/[article_id]/route': () =>
    import('@/app/api/users/self/saves/[article_id]/route'),
  'users/self/saves/feeds/route': () =>
    import('@/app/api/users/self/saves/feeds/route'),
  'users/self/saves/route': () => import('@/app/api/users/self/saves/route'),
  'users/self/saves/tags/[name]/route': () =>
    import('@/app/api/users/self/saves/tags/[name]/route'),
  'users/self/saves/tags/route': () =>
    import('@/app/api/users/self/saves/tags/route'),
  'users/self/searches/[id]/route': () =>
    import('@/app/api/users/self/searches/[id]/route'),
  'users/self/searches/route': () =>
    import('@/app/api/users/self/searches/route'),
  'users/self/shares/[article_id]/route': () =>
    import('@/app/api/users/self/shares/[article_id]/route'),
  'users/self/tokens/[id]/route': () =>
    import('@/app/api/users/self/tokens/[id]/route'),
  'users/self/tokens/route': () => import('@/app/api/users/self/tokens/route'),
  'users/self/usage/route': () => import('@/app/api/users/self/usage/route'),
  'users/self/webhooks/[id]/route': () =>
    import('@/app/api/users/self/webhooks/[id]/route'),
  'users/self/webhooks/route': () =>
    import('@/app/api/users/self/webhooks/route'),
};

beforeAll(async () => {
  const listed = routeFiles(API).map((file) =>
    path.relative(API, file).replace(/\.ts$/, ''),
  );
  expect(
    listed
      .filter((rel) => !(rel in ROUTES))
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual([]);
  for (const rel of listed) {
    const route = `/api/${rel}`
      .replace(/\/?route$/, '')
      .replaceAll(/\[([a-z_]+)\]/g, '{$1}');
    const module = await ROUTES[rel]!();
    for (const method of METHODS) {
      const handler = module[method.toUpperCase()];
      if (typeof handler === 'function') {
        handlers.set(`${method.toUpperCase()} ${route}`, handler as Handler);
      }
    }
  }
});

/** Follow a `$ref` of the document. */
function deref<T = Json>(node: unknown): T {
  let current = node as Json;
  while (typeof current?.['$ref'] === 'string') {
    current = current['$ref']
      .slice(2)
      .split('/')
      .reduce<Json>((at, key) => at[key] as Json, spec);
  }
  return current as T;
}

/** Every `$ref` in a node. */
function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => refs(n, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        found.push(value);
      } else {
        refs(value, found);
      }
    }
  } else {
    // Scalars hold no references.
  }
  return found;
}

/** A schema with `$ref` and `allOf` resolved into one object schema. */
function flat(schema: unknown): Json {
  const s = deref(schema);
  if (!Array.isArray(s['allOf'])) {
    return s;
  }
  const merged: Json = { ...s };
  delete merged['allOf'];
  let properties: Json = (s['properties'] as Json | undefined) ?? {};
  let required = (s['required'] as string[] | undefined) ?? [];
  for (const part of s['allOf'] as unknown[]) {
    const f = flat(part);
    properties = { ...properties, ...(f['properties'] as Json | undefined) };
    required = [
      ...required,
      ...((f['required'] as string[] | undefined) ?? []),
    ];
    if (f['additionalProperties'] === false) {
      merged['additionalProperties'] = false;
    }
  }
  return { ...merged, type: 'object', properties, required };
}

/** The parameters of an operation, its path's included. */
function parametersOf(op: Operation & { path: string }): Parameter[] {
  const item = spec.paths[op.path] as Json;
  return [
    ...((item['parameters'] as Json[] | undefined) ?? []),
    ...(op.parameters ?? []),
  ].map((p) => deref<unknown>(p) as Parameter);
}

const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The JSON type of a value, where a whole number is an integer. */
function jsonTypeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (Number.isInteger(value)) {
    return 'integer';
  }
  return typeof value;
}

/** What is wrong with `value` against `schema`, as messages naming where. */
function violations(schema: unknown, value: unknown, at = '$'): string[] {
  const s = deref(schema);
  if (Array.isArray(s['allOf'])) {
    return (s['allOf'] as unknown[]).flatMap((p) => violations(p, value, at));
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = s[key] as unknown[] | undefined;
    if (options) {
      return options.some((o) => violations(o, value, at).length === 0)
        ? []
        : [`${at}: matches none of ${key}`];
    }
  }
  const types = [(s['type'] as string | string[]) ?? []].flat();
  const actual = jsonTypeOf(value);
  if (
    types.length > 0 &&
    !types.includes(actual) &&
    !(actual === 'integer' && types.includes('number'))
  ) {
    return [`${at}: is ${actual}, not ${types.join('|')}`];
  }
  const problems: string[] = [];
  if (Array.isArray(s['enum']) && !s['enum'].includes(value)) {
    problems.push(`${at}: ${JSON.stringify(value)} is not in the enum`);
  }
  if (typeof value === 'string') {
    if (
      typeof s['pattern'] === 'string' &&
      !new RegExp(s['pattern']).test(value)
    ) {
      problems.push(`${at}: does not match ${s['pattern']}`);
    }
    if (s['format'] === 'date-time' && !DATE_TIME.test(value)) {
      problems.push(`${at}: ${value} is not an RFC 3339 time`);
    }
    if (s['format'] === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      problems.push(`${at}: ${value} is not a date`);
    }
    if (s['format'] === 'uri' && !URL.canParse(value)) {
      problems.push(`${at}: ${value} is not an address`);
    }
  }
  if (typeof value === 'number') {
    if (typeof s['minimum'] === 'number' && value < s['minimum']) {
      problems.push(`${at}: below ${s['minimum']}`);
    }
    if (typeof s['maximum'] === 'number' && value > s['maximum']) {
      problems.push(`${at}: above ${s['maximum']}`);
    }
  }
  if (Array.isArray(value) && s['items']) {
    value.forEach((v, i) =>
      problems.push(...violations(s['items'], v, `${at}[${i}]`)),
    );
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Json;
    const properties = (s['properties'] as Json | undefined) ?? {};
    for (const key of (s['required'] as string[] | undefined) ?? []) {
      if (!(key in object)) {
        problems.push(`${at}: lacks ${key}`);
      }
    }
    for (const [key, v] of Object.entries(object)) {
      if (key in properties) {
        problems.push(...violations(properties[key], v, `${at}.${key}`));
      } else if (s['additionalProperties'] === false) {
        problems.push(`${at}: has the undocumented member ${key}`);
      } else if (typeof s['additionalProperties'] === 'object') {
        problems.push(
          ...violations(s['additionalProperties'], v, `${at}.${key}`),
        );
      } else {
        // An extra member with no schema of its own is allowed.
      }
    }
  }
  return problems;
}

describe('openapi.json', () => {
  it('is OpenAPI 3.1 and says what it leaves out', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info['title']).toBeTruthy();
    expect(spec.info['version']).toBeTruthy();
    expect(spec.info['description']).toContain('outside `/api`');
  });

  it('resolves every $ref', () => {
    const missing = refs(spec).filter((ref) => {
      try {
        return deref<Json | undefined>({ $ref: ref }) === undefined;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it('holds only paths under /api, never one that is not REST', () => {
    const paths = Object.keys(spec.paths);
    expect(paths.filter((p) => !p.startsWith('/api/'))).toEqual([]);
    expect(
      paths.filter((p) => NOT_REST.some((prefix) => p.startsWith(prefix))),
    ).toEqual([]);
  });

  it('names its paths as lowercase plural nouns with no hyphens', () => {
    const odd = Object.keys(spec.paths).filter((path) =>
      path
        .split('/')
        .slice(1)
        .some((segment) => !/^([a-z]+|\{[a-z_]+\})$/.test(segment)),
    );
    expect(odd).toEqual([]);
  });

  it('has an operation for every route under /api, and a route for every operation', () => {
    const routes = [...handlers.keys()].filter((key) => !ALIASES.has(key));
    expect(
      routes
        .filter((key) => !operations.has(key))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([]);
    expect(
      [...operations.keys()]
        .filter((key) => !handlers.has(key))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([]);
  });

  it('keeps the aliases out of the contract', () => {
    expect([...ALIASES].filter((key) => operations.has(key))).toEqual([]);
    expect([...ALIASES].filter((key) => !handlers.has(key))).toEqual([]);
  });

  it('describes every operation fully', () => {
    const declared = new Set(spec.tags.map((t) => t.name));
    const ids = new Set<string>();
    const lacking: string[] = [];
    for (const [key, op] of operations) {
      if (
        !/^[a-z][A-Za-z0-9]+$/.test(op.operationId) ||
        ids.has(op.operationId)
      ) {
        lacking.push(`${key}: operationId`);
      }
      ids.add(op.operationId);
      if (!op.tags?.length || op.tags.some((t) => !declared.has(t))) {
        lacking.push(`${key}: tags`);
      }
      if (!op.summary) {
        lacking.push(`${key}: summary`);
      }
      if (!op.security && !spec.security) {
        lacking.push(`${key}: security`);
      }
      const names = new Set(
        parametersOf(op)
          .filter((p) => p.in === 'path')
          .map((p) => p.name),
      );
      const wanted = [...op.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      if (wanted.some((n) => !names.has(n!)) || names.size !== wanted.length) {
        lacking.push(`${key}: path parameters`);
      }
      for (const p of parametersOf(op).filter((x) => x.in === 'path')) {
        if (!p.required) {
          lacking.push(`${key}: ${p.name} must be required`);
        }
      }
      if (
        ['POST', 'PUT', 'PATCH'].includes(key.split(' ', 1)[0]!) &&
        !op.responses['415'] &&
        op.requestBody
      ) {
        const types = Object.keys(
          (deref(op.requestBody)['content'] as Json) ?? {},
        );
        if (types.some((t) => t.includes('json')) && !op.responses['400']) {
          lacking.push(`${key}: 400`);
        }
      }
    }
    expect(lacking).toEqual([]);
  });

  it('answers every error as a problem document, and every creation with a Location', () => {
    const wrong: string[] = [];
    for (const [key, op] of operations) {
      for (const [status, raw] of Object.entries(op.responses)) {
        const response = deref(raw);
        const content = (response['content'] as Json | undefined) ?? {};
        const problemSchema = (
          content['application/problem+json'] as Json | undefined
        )?.['schema'];
        if (
          Number(status) >= 400 &&
          (Object.keys(content).join(',') !== 'application/problem+json' ||
            !problemSchema)
        ) {
          wrong.push(`${key} ${status}: not application/problem+json`);
        }
        if (
          status === '201' &&
          !(response['headers'] as Json | undefined)?.['Location']
        ) {
          wrong.push(`${key} 201: no Location`);
        }
        if (status === '204' && Object.keys(content).length > 0) {
          wrong.push(`${key} 204: has a body`);
        }
      }
      if (
        parametersOf(op).some((p) => p.name === 'If-Match') &&
        !op.responses['412']
      ) {
        wrong.push(`${key}: If-Match without 412`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('openapi.json members and security', () => {
  it('names JSON members in snake_case and times as RFC 3339', () => {
    const wrong: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${at}[${i}]`));
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (['example', 'examples', 'enum'].includes(key)) {
            continue;
          }
          if (key === 'properties' && value && typeof value === 'object') {
            // eslint-disable-next-line sonarjs/nested-control-flow -- extracting this walk would be a large logic rewrite
            for (const [name, schema] of Object.entries(value)) {
              // The browser's own PushSubscription member, accepted next to expiration_time.
              if (
                !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name) &&
                name !== 'expirationTime'
              ) {
                wrong.push(`${at}: ${name}`);
              }
              const type = (schema as Json)['type'];
              const isString =
                type === 'string' ||
                (Array.isArray(type) && type.includes('string'));
              if (
                name.endsWith('_at') &&
                isString &&
                (schema as Json)['format'] !== 'date-time'
              ) {
                wrong.push(`${at}: ${name} is not date-time`);
              }
            }
          }
          walk(value, `${at}.${key}`);
        }
      } else {
        // Scalars have no members to check.
      }
    };
    walk(spec.paths, 'paths');
    walk(spec.components, 'components');
    expect(wrong).toEqual([]);
  });

  it('declares the cursor on every list that has a next page', () => {
    const wrong: string[] = [];
    for (const [key, op] of operations) {
      const schema = (
        deref(op.responses['200'] ?? {})['content'] as Json | undefined
      )?.['application/json'] as Json | undefined;
      const properties = schema
        ? (flat(schema['schema'])['properties'] as Json | undefined)
        : undefined;
      if (properties?.['next']) {
        const names = new Set(parametersOf(op).map((p) => p.name));
        if (!names.has('cursor') || !names.has('limit')) {
          wrong.push(key);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('declares only the session cookie, which any signed-in person holds', () => {
    expect(Object.keys(spec.components['securitySchemes']!)).toEqual([
      'session',
    ]);
    expect(spec.security).toEqual([{ session: [] }]);
    expect(
      String(
        (spec.components['securitySchemes']!['session'] as Json)['description'],
      ),
    ).toContain('curator capability');
  });

  it('leaves no component unused', () => {
    const used = new Set(refs(spec));
    const unused = Object.entries(spec.components)
      .filter(([kind]) => kind !== 'securitySchemes')
      .flatMap(([kind, items]) =>
        Object.keys(items).map((name) => `#/components/${kind}/${name}`),
      )
      .filter((ref) => !used.has(ref));
    expect(unused).toEqual([]);
  });
});

/** The signed-in caller, and a second person. */
const ME = 7;

/** What a fresh world holds, as the ids the requests name. */
interface World {
  feed: string;
  source: string;
  article: string;
  section: string;
  classifier: string;
  search: string;
  token: string;
  webhook: string;
  rule: string;
  push: string;
  river: string;
  edition: string;
  conversation: string;
  briefing: string;
  recommendation: string;
  feedImport: string;
  day: string;
}

/** One request to make: its path values, query, body and expected status. */
interface Case {
  params?: Record<string, string>;
  query?: string;
  body?: unknown;
  /** A body that is not JSON: its media type and text. */
  raw?: { type: string; text: string };
  headers?: Record<string, string>;
  /** What must have happened before: operations and the cases they are called with. */
  setup?: [string, Case][];
  status: number;
}

/** The day the followed feed has stories for, and a day before it with a stored paper. */
const DAY = '2026-10-20';
const EARLIER = '2026-10-19';

/** The feed an address leads to, for any address. */
const FEED_XML =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><link>https://a.example.org/</link><item><title>One</title><link>https://a.example.org/1</link><guid>1</guid></item></channel></rss>';

const OPML =
  '<?xml version="1.0"?><opml version="2.0"><head/><body><outline text="A" type="rss" xmlUrl="https://o.example.org/feed"/></body></opml>';

const READ = 'POST /api/users/self/reads/{article_id}';
const SAVE = 'POST /api/users/self/saves/{article_id}';
const SHARE = 'POST /api/users/self/shares/{article_id}';
const NOTIFY = 'PUT /api/users/self/notifications/{feed_id}';

const PLAYER = (w: World): Case => ({
  body: {
    rate: 1,
    current: { article_id: w.article, position: 12 },
    queue: [],
    history: [],
  },
  status: 200,
});
const SAVED = (w: World): Case => ({
  params: { article_id: w.article },
  body: { tags: ['later'] },
  status: 201,
});
const SHARED = (w: World): Case => ({
  params: { article_id: w.article },
  body: { comments: 'Worth a read.' },
  status: 201,
});
const NOTIFIED = (w: World): Case => ({
  params: { feed_id: w.feed },
  body: { channels: ['web'] },
  status: 201,
});

/** The requests that succeed, by operation. */
const VALID: Record<string, (w: World) => Case> = {
  'GET /api/articles': () => ({ query: 'q=rust', status: 200 }),
  'GET /api/articles/{id}': (w) => ({ params: { id: w.article }, status: 200 }),
  'GET /api/articles/{id}/similar': (w) => ({
    params: { id: w.article },
    status: 200,
  }),
  'POST /api/articles/{id}/extractions': (w) => ({
    params: { id: w.article },
    status: 200,
  }),
  'POST /api/editions': () => ({ body: { name: 'Second' }, status: 201 }),
  'PATCH /api/editions/{id}': (w) => ({
    params: { id: w.edition },
    body: { name: 'Renamed' },
    status: 200,
  }),
  'DELETE /api/editions/{id}': (w) => ({
    params: { id: w.edition },
    status: 204,
  }),
  'GET /api/editions/{id}/issues/{date}': (w) => ({
    params: { id: w.edition, date: w.day },
    status: 200,
  }),
  'GET /api/editions/self/briefings': () => ({ status: 200 }),
  'POST /api/editions/self/briefings': () => ({ status: 404 }),
  'GET /api/editions/self/briefings/{id}': (w) => ({
    params: { id: w.briefing },
    status: 200,
  }),
  'GET /api/editions/self/issues': () => ({ status: 200 }),
  'POST /api/editions/self/issues': () => ({
    body: { date: DAY },
    status: 201,
  }),
  'GET /api/editions/self/issues/{date}': (w) => ({
    params: { date: w.day },
    status: 200,
  }),
  'POST /api/articles/{id}/answers': (w) => ({
    params: { id: w.article },
    body: { question: 'What is it about?' },
    status: 200,
  }),
  'GET /api/conversations': () => ({ status: 200 }),
  'POST /api/conversations': () => ({ status: 201 }),
  'GET /api/conversations/suggestions': () => ({ status: 200 }),
  'GET /api/conversations/{id}': (w) => ({
    params: { id: w.conversation },
    status: 200,
  }),
  'DELETE /api/conversations/{id}': (w) => ({
    params: { id: w.conversation },
    status: 204,
  }),
  'POST /api/conversations/{id}/messages': (w) => ({
    params: { id: w.conversation },
    body: { content: 'What happened today?' },
    status: 201,
  }),
  'POST /api/articles/{id}/emails': (w) => ({
    params: { id: w.article },
    body: { to: 'friend@example.org' },
    status: 202,
  }),
  'GET /api/feeds': () => ({ status: 200 }),
  'POST /api/feeds': () => ({
    body: { url: 'https://new.example.org/feed.xml' },
    status: 201,
  }),
  'PATCH /api/feeds/{id}': (w) => ({
    params: { id: w.feed },
    body: { title: 'Mine' },
    status: 200,
  }),
  'DELETE /api/feeds/{id}': (w) => ({ params: { id: w.feed }, status: 204 }),
  'POST /api/feeds/imports': () => ({
    raw: { type: 'text/x-opml', text: OPML },
    status: 201,
  }),
  'GET /api/feeds/imports/{id}': (w) => ({
    params: { id: w.feedImport },
    status: 200,
  }),
  'POST /api/feeds/{id}/refreshes': (w) => ({
    params: { id: w.feed },
    status: 200,
  }),
  'GET /api/feeds/{id}/statistics': (w) => ({
    params: { id: w.feed },
    status: 200,
  }),
  'GET /api/feeds/{id}/similar': (w) => ({
    params: { id: w.feed },
    status: 200,
  }),
  'GET /api/feeds/trending': () => ({ status: 200 }),
  'POST /api/feeds/conversions': () => ({
    body: { url: 'https://example.substack.com' },
    status: 200,
  }),
  'GET /api/feeds/recommendations': () => ({ status: 200 }),
  'POST /api/feeds/recommendations': () => ({
    body: {
      url: 'https://fresh.example.org/feed',
      description: 'Worth reading.',
    },
    status: 201,
  }),
  'PATCH /api/feeds/recommendations/{id}': (w) => ({
    params: { id: w.recommendation },
    body: { status: 'declined' },
    headers: { 'Content-Type': 'application/merge-patch+json' },
    status: 200,
  }),
  'GET /api/podcasts': () => ({ query: 'q=rust', status: 200 }),
  'GET /api/news/topics': () => ({ status: 200 }),
  'POST /api/transcriptions': () => ({
    raw: { type: 'audio/webm', text: 'not really audio' },
    status: 200,
  }),
  'GET /api/feeds/suggestions': () => ({ status: 200 }),
  'POST /api/feeds/refreshes': () => ({ status: 200 }),
  'POST /api/feeds/moves': (w) => ({
    body: { feed_ids: [w.feed], section_id: w.section },
    status: 200,
  }),
  'POST /api/feeds/removals': (w) => ({
    body: { feed_ids: [w.feed] },
    status: 200,
  }),
  'GET /api/push/configuration': () => ({ status: 200 }),
  'GET /api/sources': () => ({ query: 'order=reads', status: 200 }),
  'POST /api/sections': () => ({ body: { name: 'World' }, status: 201 }),
  'PATCH /api/sections/{id}': (w) => ({
    params: { id: w.section },
    body: { name: 'Tech news' },
    status: 200,
  }),
  'DELETE /api/sections/{id}': (w) => ({
    params: { id: w.section },
    status: 204,
  }),
  'GET /api/topics': () => ({ status: 200 }),
  'DELETE /api/sessions': () => ({ status: 204 }),
  'DELETE /api/sessions/self': () => ({ status: 204 }),
  'GET /api/users/self/classifiers': () => ({ status: 200 }),
  'POST /api/users/self/classifiers': () => ({
    body: { kind: 'title', value: 'zig', score: 'like' },
    status: 201,
  }),
  'DELETE /api/users/self/classifiers/{id}': (w) => ({
    params: { id: w.classifier },
    status: 204,
  }),
  'GET /api/users/self/searches': () => ({ status: 200 }),
  'POST /api/users/self/searches': () => ({
    body: { query: 'zig' },
    status: 201,
  }),
  'DELETE /api/users/self/searches/{id}': (w) => ({
    params: { id: w.search },
    status: 204,
  }),
  'GET /api/users/self/player': () => ({ status: 200 }),
  'PUT /api/users/self/player': (w) => PLAYER(w),
  'DELETE /api/users/self/player': (w) => ({
    setup: [['PUT /api/users/self/player', PLAYER(w)]],
    status: 204,
  }),
  'POST /api/users/self/reads': (w) => ({
    body: { article_ids: [w.article] },
    status: 200,
  }),
  'GET /api/users/self/preferences': () => ({ status: 200 }),
  'PATCH /api/users/self/preferences': () => ({
    body: { mark_read_on_scroll: true },
    status: 200,
  }),
  'POST /api/users/self/reads/{article_id}': (w) => ({
    params: { article_id: w.article },
    status: 201,
  }),
  'PATCH /api/users/self/reads/{article_id}': (w) => ({
    setup: [[READ, { params: { article_id: w.article }, status: 201 }]],
    params: { article_id: w.article },
    body: { seconds: 30 },
    status: 200,
  }),
  'DELETE /api/users/self/reads/{article_id}': (w) => ({
    setup: [[READ, { params: { article_id: w.article }, status: 201 }]],
    params: { article_id: w.article },
    status: 204,
  }),
  'GET /api/users/self/rivers': () => ({ status: 200 }),
  'POST /api/users/self/rivers': () => ({
    body: { river_id: 'saves', side: 'left', position: 1 },
    status: 201,
  }),
  'PUT /api/users/self/rivers': () => ({
    body: { items: [{ river_id: 'all', side: 'right', position: 0 }] },
    status: 200,
  }),
  'DELETE /api/users/self/rivers/{id}': (w) => ({
    params: { id: w.river },
    status: 204,
  }),
  'GET /api/users/self/saves': () => ({ status: 200 }),
  'GET /api/users/self/saves/tags': () => ({ status: 200 }),
  'PATCH /api/users/self/saves/tags/{name}': (w) => ({
    setup: [[SAVE, SAVED(w)]],
    params: { name: 'later' },
    body: { name: 'sooner' },
    status: 200,
  }),
  'DELETE /api/users/self/saves/tags/{name}': (w) => ({
    setup: [[SAVE, SAVED(w)]],
    params: { name: 'later' },
    status: 204,
  }),
  'GET /api/users/self/saves/feeds': () => ({ status: 200 }),
  'POST /api/users/self/saves/{article_id}': (w) => SAVED(w),
  'DELETE /api/users/self/saves/{article_id}': (w) => ({
    setup: [[SAVE, SAVED(w)]],
    params: { article_id: w.article },
    status: 204,
  }),
  'POST /api/users/self/shares/{article_id}': (w) => SHARED(w),
  'DELETE /api/users/self/shares/{article_id}': (w) => ({
    setup: [[SHARE, SHARED(w)]],
    params: { article_id: w.article },
    status: 204,
  }),
  'GET /api/shares': () => ({ status: 200 }),
  'POST /api/users/self/notifications/rules': () => ({
    body: { kind: 'title', value: 'zig', channels: ['web'] },
    status: 201,
  }),
  'DELETE /api/users/self/notifications/rules/{id}': (w) => ({
    params: { id: w.rule },
    status: 204,
  }),
  'PUT /api/users/self/notifications/{feed_id}': (w) => NOTIFIED(w),
  'DELETE /api/users/self/notifications/{feed_id}': (w) => ({
    setup: [[NOTIFY, NOTIFIED(w)]],
    params: { feed_id: w.feed },
    status: 204,
  }),
  'POST /api/users/self/push/subscriptions': () => ({
    body: {
      endpoint: 'https://push.example.org/other',
      keys: { p256dh: 'B'.repeat(87), auth: 'B'.repeat(22) },
    },
    status: 201,
  }),
  'DELETE /api/users/self/push/subscriptions/{id}': (w) => ({
    params: { id: w.push },
    status: 204,
  }),
  'GET /api/users/self/usage': () => ({ status: 200 }),
  'POST /api/users/self/tokens': () => ({
    body: { scope: 'saves' },
    status: 201,
  }),
  'DELETE /api/users/self/tokens/{id}': (w) => ({
    params: { id: w.token },
    status: 204,
  }),
  'POST /api/users/self/webhooks': () => ({
    body: { url: 'https://hooks.example.org/new', events: ['like'] },
    status: 201,
  }),
  'DELETE /api/users/self/webhooks/{id}': (w) => ({
    params: { id: w.webhook },
    status: 204,
  }),
};

let restore: (() => void) | null = null;
let cookie: string;

/** Call the route of an operation as the caller (or nobody). */
async function call(
  key: string,
  c: Case,
  options: { cookie?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const [method, path] = key.split(' ') as [string, string];
  const params = c.params ?? {};
  const pathname = path.replaceAll(/\{([a-z_]+)\}/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? 'x'),
  );
  const query = c.query ? `?${c.query}` : '';
  const url = `https://app.test${pathname}${query}`;
  const headers: Record<string, string> = {};
  const who = options.cookie === undefined ? cookie : options.cookie;
  jar.clear();
  if (who) {
    headers['cookie'] = `${SESSION_COOKIE}=${who}`;
    jar.set(SESSION_COOKIE, who);
  }
  let body: string | undefined;
  if (c.raw) {
    headers['Content-Type'] = c.raw.type;
    body = c.raw.text;
  } else if (c.body === undefined) {
    // Without a raw or JSON body, the request sends no body.
  } else {
    headers['Content-Type'] = 'application/json';
    body = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
  }
  Object.assign(headers, c.headers, options.headers);
  const handler = handlers.get(key);
  if (!handler) {
    throw new Error(`no route for ${key}`);
  }
  return handler(new Request(url, { method, headers, body }), {
    params: Promise.resolve(params),
  });
}

/** Make a thing through its route and read what it answered. */
async function make(key: string, body?: unknown): Promise<Json> {
  const res = await call(key, { body, status: 0 });
  if (res.status >= 300) {
    throw new Error(`${key} answered ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Json;
}

/** A fresh database with one person who has something of everything. */
async function world(): Promise<World> {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    AI: {
      run: jest.fn(async () => ({
        response: 'An answer.',
        text: 'a spoken question',
      })),
    },
    EMAIL: { send: jest.fn(async () => ({})) },
    EMAIL_FROM: 'news@example.org',
    VAPID_PUBLIC_KEY: 'BPublicKey',
    CURATOR_EMAILS: 'a@example.org',
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@example.org', 'g8', 'b@example.org');
  cookie = await tokenFor({ id: ME }, { ep: 0 });
  const repo = new Repository(databaseFrom(made.d1));
  const feed = (await repo.addFeed(ME, 'https://a.example.org/feed'))!;
  await repo.writeEdition(feed.source_id, DAY, [
    {
      url: 'https://a.example.org/1',
      title: 'Rust ships',
      source: 'a',
      favicon: '',
      summary: 'Rust ships a release.',
      image: '',
      published_at: '',
      points: 0,
      body_text: 'All about rust and its release.',
    },
  ]);
  const articles = await repo.sourceArticles(feed.source_id, DAY);
  const article = articles[0]!;
  const briefing = await repo.saveBriefing({
    user_id: ME,
    slot: 'morning',
    local_date: DAY,
    frequency: 'daily',
    period_start: '2026-10-19T08:30:00.000Z',
    title: 'Morning',
    summary: 'Note.',
    stories: '[]',
    sections: '[]',
    status: 'complete',
    error: null,
    model: null,
    tokens: null,
    seconds: null,
  });
  await repo.saveIssue(
    ME,
    EARLIER,
    JSON.stringify({ groups: [{ name: null, desks: [] }] }),
    'Note.',
  );
  const conversation = await repo.addConversation(ME);
  const id = (thing: Json) => String(thing['id']);
  const section = await make('POST /api/sections', { name: 'Tech' });
  const classifier = await make('POST /api/users/self/classifiers', {
    kind: 'title',
    value: 'rust',
    score: 'like',
  });
  const search = await make('POST /api/users/self/searches', { query: 'rust' });
  const token = await make('POST /api/users/self/tokens', { scope: 'saves' });
  const webhook = await make('POST /api/users/self/webhooks', {
    url: 'https://hooks.example.org/x',
    events: ['save'],
  });
  const rule = await make('POST /api/users/self/notifications/rules', {
    kind: 'title',
    value: 'rust',
    channels: ['web'],
  });
  const push = await make('POST /api/users/self/push/subscriptions', {
    endpoint: 'https://push.example.org/abc',
    keys: { p256dh: 'A'.repeat(87), auth: 'A'.repeat(22) },
  });
  const river = await make('POST /api/users/self/rivers', {
    river_id: 'all',
    side: 'left',
    position: 0,
  });
  const edition = await make('POST /api/editions', { name: 'Mine' });
  const recommendation = await make('POST /api/feeds/recommendations', {
    url: 'https://r.example.org/feed',
    description: 'Good.',
  });
  await repo.saveEditionIssue(
    Number(edition['id']),
    EARLIER,
    JSON.stringify({ groups: [{ name: null, desks: [] }] }),
    null,
  );
  const feedImport = await new FeedImportRuns(databaseFrom(made.d1)).start(
    ME,
    3,
  );
  return {
    feed: String(feed.id),
    source: String(feed.source_id),
    article: String(article.id),
    section: id(section),
    classifier: id(classifier),
    search: id(search),
    token: id(token),
    webhook: id(webhook),
    rule: id(rule),
    push: id(push),
    river: id(river),
    edition: id(edition),
    conversation: String(conversation.id),
    briefing: String(briefing.id),
    recommendation: id(recommendation),
    feedImport: feedImport.id,
    day: EARLIER,
  };
}

beforeEach(() => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.includes('itunes.apple.com')
      ? Response.json({
          resultCount: 1,
          results: [
            {
              collectionName: 'Podcast',
              artistName: 'Someone',
              feedUrl: 'https://p.example.org/feed',
              artworkUrl100: 'https://p.example.org/a.jpg',
            },
          ],
        })
      : new Response(FEED_XML, {
          headers: { 'Content-Type': 'application/rss+xml' },
        });
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  restore?.();
  restore = null;
  jest.restoreAllMocks();
});

/** A value of the wrong type for a member, or one outside its enum. */
function wrongValue(schema: unknown): unknown {
  const s = deref(schema);
  if (Array.isArray(s['enum'])) {
    return '__not_a_member__';
  }
  const type = [(s['type'] as string | string[]) ?? []]
    .flat()
    .find((t) => t !== 'null');
  if (type === 'string') {
    return 12_345;
  }
  return type ? 'text' : undefined;
}

/** Text that is no id, date, number or choice, for a path or query. */
const JUNK_TEXT = [
  '',
  '-1',
  '0',
  '1.5',
  '99999999999999999999',
  '%00',
  '..',
  '😀',
  '2026-13-45',
  'x'.repeat(3000),
];

/** Values of every kind, for a member of a body. */
const JUNK_JSON: unknown[] = [
  null,
  '',
  [],
  {},
  -1,
  0,
  1.5,
  1e21,
  true,
  'x'.repeat(5000),
  '\u0000',
  '😀',
  { a: 1 },
  [1],
  [null],
];

/** The statuses an operation documents. */
const documented = (op: Operation): Set<number> =>
  new Set(Object.keys(op.responses).map(Number));

/** The media type of a response, without parameters. */
const mediaType = (res: Response): string =>
  (res.headers.get('content-type') ?? '').split(';', 1)[0]!.trim();

/**
 * What is wrong with an answer: a status the operation does not document, an
 * error that is not a problem document, or a body that does not fit its schema.
 */
async function wrongAnswer(op: Operation, res: Response): Promise<string[]> {
  const wrong: string[] = [];
  const status = String(res.status);
  const response = op.responses[status];
  if (!response) {
    return [`${res.status} is not documented`];
  }
  const content = (deref(response)['content'] as Json | undefined) ?? {};
  const type = mediaType(res);
  if (res.status >= 400 && type !== 'application/problem+json') {
    wrong.push(`${res.status} is ${type || 'empty'}, not a problem`);
  }
  const entry = content[type] as Json | undefined;
  if (res.status !== 204 && type && !entry) {
    wrong.push(`${res.status} ${type} is not documented`);
  }
  if (entry?.['schema'] && type.endsWith('json')) {
    const body = (await res.clone().json()) as unknown;
    wrong.push(
      ...violations(entry['schema'], body).map((v) => `${res.status} ${v}`),
    );
  }
  const headers = (deref(response)['headers'] as Json | undefined) ?? {};
  if (headers['Location'] && !res.headers.get('location')) {
    wrong.push(`${res.status} lacks Location`);
  }
  return wrong;
}

describe('the controllers agree with openapi.json', () => {
  it('keeps the curator capability to the people the operator named', async () => {
    await world();
    const other = await tokenFor({ id: 8 }, { ep: 0 });
    const refusals = [
      await call(
        'PATCH /api/feeds/recommendations/{id}',
        {
          params: { id: '1' },
          body: { status: 'declined' },
          headers: { 'Content-Type': 'application/merge-patch+json' },
          status: 403,
        },
        { cookie: other },
      ),
      await call(
        'GET /api/feeds/recommendations',
        { query: 'status=pending', status: 403 },
        { cookie: other },
      ),
    ];
    expect(refusals.map((r) => r.status)).toEqual([403, 403]);
    expect(refusals.map((r) => mediaType(r))).toEqual([
      'application/problem+json',
      'application/problem+json',
    ]);
  });

  it('has a valid request for every operation', () => {
    expect(
      [...operations.keys()]
        .filter((key) => !(key in VALID))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([]);
    expect(Object.keys(VALID).filter((key) => !operations.has(key))).toEqual(
      [],
    );
  });
});

describe('every operation agrees with openapi.json', () => {
  it.each([...operations.keys()])('%s', async (key) => {
    const op = operations.get(key)!;
    const w = await world();
    const valid = VALID[key]!(w);
    for (const [before, c] of valid.setup ?? []) {
      const done = await call(before, c);
      expect(done.status).toBe(c.status);
    }
    const wrong: string[] = [];
    const fail = (what: string, problems: string[]) =>
      problems.forEach((p) => wrong.push(`${what}: ${p}`));
    const isPublic = Array.isArray(op.security) && op.security.length === 0;
    const writes = key.split(' ', 1)[0] !== 'GET';

    // Who may call it: the spec and the controller must say the same.
    const anonymous = await call(key, valid, { cookie: null });
    if (isPublic) {
      if (anonymous.status === 401) {
        wrong.push('declared public but answers 401 without a session');
      }
    } else {
      if (anonymous.status !== 401) {
        wrong.push(
          `declared secured but answers ${anonymous.status} without a session`,
        );
      }
      fail('no session', await wrongAnswer(op, anonymous));
    }
    if (writes && !isPublic) {
      const crossSite = await call(key, valid, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      if (crossSite.status !== 403) {
        wrong.push(`a cross-site write answers ${crossSite.status}, not 403`);
      }
      fail('cross-site', await wrongAnswer(op, crossSite));
    }

    // Input it must refuse, each time with a documented 4xx problem.
    const refused = async (what: string, c: Case, want?: number) => {
      const res = await call(key, c);
      if (res.status >= 500 || res.status < 400) {
        wrong.push(`${what}: answers ${res.status}`);
      } else if (want && res.status !== want) {
        wrong.push(`${what}: answers ${res.status}, not ${want}`);
      } else {
        // The answer is one the case allows.
      }
      fail(what, await wrongAnswer(op, res));
    };
    const parameters = parametersOf(op);
    for (const p of parameters.filter((x) => x.in === 'path')) {
      const pattern = deref(p.schema)['pattern'];
      const format = deref(p.schema)['format'];
      if (pattern || format) {
        await refused(
          `${p.name} that is not one`,
          {
            ...valid,
            params: { ...valid.params, [p.name]: 'not-valid' },
          },
          404,
        );
      }
    }
    for (const p of parameters.filter((x) => x.in === 'query')) {
      const bad = wrongValue(p.schema);
      // Everything in a query is text, so only a number, a flag or a choice can be wrong.
      if (bad !== undefined && typeof bad !== 'number') {
        const query = new URLSearchParams(valid.query ?? '');
        query.set(p.name, String(bad));
        await refused(
          `bad ${p.name}`,
          { ...valid, query: query.toString() },
          400,
        );
      }
    }
    const content = op.requestBody
      ? ((deref(op.requestBody)['content'] as Json) ?? {})
      : {};
    const json = Object.entries(content).find(([type]) =>
      type.includes('json'),
    );
    if (json) {
      const schema = flat((json[1] as Json)['schema']);
      const properties = (schema['properties'] as Json | undefined) ?? {};
      const asJson = (body: string, type = 'application/json') => ({
        ...valid,
        body,
        headers: { 'Content-Type': type },
      });
      await refused('a body that is not JSON', asJson('{'), 400);
      await refused('a body that is text', asJson('hello', 'text/plain'), 415);
      await refused('a body that is an array', asJson('[]'), 400);
      await refused('a body that is null', asJson('null'), 400);
      for (const required of valid.body
        ? ((schema['required'] as string[] | undefined) ?? [])
        : []) {
        const rest = Object.fromEntries(
          Object.entries((valid.body ?? {}) as Json).filter(
            ([name]) => name !== required,
          ),
        );
        await refused(`no ${required}`, { ...valid, body: rest }, 400);
      }
      for (const [name, member] of Object.entries(properties)) {
        const bad = wrongValue(member);
        if (bad !== undefined && valid.body && name in (valid.body as Json)) {
          await refused(
            `${name} of the wrong type`,
            { ...valid, body: { ...(valid.body as Json), [name]: bad } },
            400,
          );
        }
      }
    }
    for (const [type] of Object.entries(content).filter(
      ([t]) => !t.includes('json'),
    )) {
      await refused(
        `an empty ${type} body`,
        { ...valid, raw: { type, text: '' } },
        400,
      );
    }

    // What it does with valid input, and whether the answer fits the spec.
    const res = await call(key, valid);
    if (res.status !== valid.status) {
      wrong.push(
        `valid request answers ${res.status}, not ${valid.status}: ${await res.clone().text()}`,
      );
    }
    fail('valid', await wrongAnswer(op, res));

    // An unknown member is refused exactly when the spec says it is.
    if (json && valid.body && typeof valid.body === 'object') {
      const strict =
        flat((json[1] as Json)['schema'])['additionalProperties'] === false;
      const extra = await call(key, {
        ...valid,
        body: { ...(valid.body as Json), not_a_member: 1 },
      });
      if ((extra.status === 400) !== strict) {
        wrong.push(
          `the spec ${strict ? 'forbids' : 'allows'} unknown members but the controller answers ${extra.status}`,
        );
      }
    }

    // Nothing a client sends may make it answer 500.
    const survives = async (what: string, c: Case) => {
      const res = await call(key, c);
      if (res.status >= 500 && !documented(op).has(res.status)) {
        wrong.push(`${what}: answers ${res.status}`);
      } else if (res.status >= 500) {
        wrong.push(`${what}: answers ${res.status} to input it could refuse`);
      } else {
        fail(what, await wrongAnswer(op, res));
      }
    };
    for (const p of parameters.filter((x) => x.in === 'path')) {
      for (const junk of JUNK_TEXT) {
        await survives(`${p.name} ${JSON.stringify(junk).slice(0, 20)}`, {
          ...valid,
          params: { ...valid.params, [p.name]: junk },
        });
      }
    }
    for (const p of parameters.filter((x) => x.in === 'query')) {
      for (const junk of JUNK_TEXT) {
        const query = new URLSearchParams(valid.query ?? '');
        query.set(p.name, junk);
        await survives(`${p.name} ${JSON.stringify(junk).slice(0, 20)}`, {
          ...valid,
          query: query.toString(),
        });
      }
    }
    if (json && valid.body && typeof valid.body === 'object') {
      const names = new Set(Object.keys(valid.body as Json));
      const declared =
        (flat((json[1] as Json)['schema'])['properties'] as Json | undefined) ??
        {};
      for (const name of Object.keys(declared)) {
        names.add(name);
      }
      for (const name of names) {
        for (const junk of JUNK_JSON) {
          await survives(`${name} ${JSON.stringify(junk)?.slice(0, 20)}`, {
            ...valid,
            body: { ...(valid.body as Json), [name]: junk },
          });
        }
      }
      for (const junk of [1, 'text', true]) {
        await survives(`a body that is ${JSON.stringify(junk)}`, {
          ...valid,
          body: junk,
        });
      }
    }
    expect(wrong).toEqual([]);
  });
});
