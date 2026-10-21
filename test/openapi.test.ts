import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { SESSION_COOKIE } from '../src/lib/auth/app';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'src/app/api');
const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/** Every `METHOD /api/...` the route files export, e.g. `delete /api/feeds/{id}`. */
function routesInSource(dir = API_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return routesInSource(full);
    }
    if (entry.name !== 'route.ts') {
      return [];
    }
    const url = `/api/${path.relative(API_DIR, dir)}`
      .replace(/\/$/, '')
      .replace(/\[([^\]]+)\]/g, '{$1}');
    const source = readFileSync(full, 'utf8');
    return [...source.matchAll(/export (?:async )?function ([A-Z]+)\b/g)].map(
      (m) => `${m[1]!.toLowerCase()} ${url}`,
    );
  });
}

const METHOD_KEYS = new Set(METHODS);

interface Spec {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components: {
    readonly securitySchemes: Readonly<Record<string, { name?: string }>>;
    readonly schemas: Readonly<Record<string, unknown>>;
  };
}

const text = readFileSync(path.join(ROOT, 'openapi/openapi.json'), 'utf8');
const spec = JSON.parse(text) as Spec;

/** Every `method path` the spec describes. */
function routesInSpec(): string[] {
  return Object.entries(spec.paths).flatMap(([url, item]) =>
    Object.keys(item)
      .filter((key) => METHOD_KEYS.has(key))
      .map((method) => `${method} ${url}`),
  );
}

describe('openapi/openapi.json', () => {
  it('describes every route under src/app/api, and nothing else', () => {
    expect(routesInSpec().toSorted()).toEqual(routesInSource().toSorted());
  });

  it('names the cookie the app really sets', () => {
    expect(spec.components.securitySchemes['session']?.name).toBe(
      SESSION_COOKIE,
    );
  });

  it('describes errors as problem documents', () => {
    expect(text).toContain('application/problem+json');
  });
});
