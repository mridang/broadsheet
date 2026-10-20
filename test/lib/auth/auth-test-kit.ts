import { jest } from '@jest/globals';
import { NextRequest } from 'next/server';

import { createSessionToken } from '../../../src/lib/auth/session';
import { installCloudflareContext } from '../db/sqlite-d1';

/** The session secret the sign-in tests use. */
export const SESSION_SECRET = 'test-session-secret-value-0123456789';

/** The request cookies a test "browser" sends; tests set and clear entries. */
export const jar = new Map<string, string>();

/**
 * Stands in for Next's `cookies()`: answers from {@link jar}. Mock
 * `next/headers` with it before importing code that reads the session.
 */
export const fakeCookies = async () => ({
  get: (name: string) => {
    const value = jar.get(name);
    return value === undefined ? undefined : { name, value };
  },
});

/**
 * Make `env` the Worker environment the code under test finds (there is no
 * database: tests of the sign-in code stand in for the app's store). Returns
 * the function that puts things back.
 */
export function installEnv(
  env: Readonly<Record<string, unknown>> = {
    SESSION_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  },
): () => void {
  return installCloudflareContext({} as D1Database, env);
}

/** A signed session token for a person, optionally under a given epoch or expiry. */
export function tokenFor(
  user: Readonly<{ id: number; email?: string }>,
  options: Readonly<{ ep?: number; exp?: number; secret?: string }> = {},
): Promise<string> {
  const { secret, ...claims } = options;
  return createSessionToken(
    { uid: user.id, email: user.email ?? 'a@b.com', ...claims },
    secret ?? SESSION_SECRET,
  );
}

/** A request to the app at `path`, as the browser would send it, carrying whatever is in {@link jar}. */
export function appRequest(
  method: string,
  path: string,
  init: Readonly<{ headers?: Record<string, string> }> = {},
): NextRequest {
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  return new NextRequest(`https://app.test${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

/**
 * Answer every `fetch` from the code under test, by the start of the address
 * (the first matching entry wins). A request nobody answers for is a test
 * mistake and throws. Returns the addresses requested, as `METHOD url`.
 */
export function answerFetch(
  answers: Readonly<Record<string, (init?: RequestInit) => Response>>,
): string[] {
  const requested: string[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requested.push(`${init?.method ?? 'GET'} ${url}`);
    const key = Object.keys(answers).find((prefix) => url.startsWith(prefix));
    if (!key) {
      throw new Error(`Unexpected request in a test: ${url}`);
    }
    return answers[key]!(init);
  });
  return requested;
}
