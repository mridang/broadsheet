import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  getDB,
  getEnv,
  isDatabaseBound,
  runInBackground,
} from '@/lib/core/runtime';
import { installCloudflareContext, sqliteD1 } from './db/sqlite-d1';

describe('without a Cloudflare context (tests, scripts)', () => {
  it('reports the database as not bound instead of throwing', () => {
    expect(isDatabaseBound()).toBe(false);
  });

  it('throws when asked for the binding or the environment', () => {
    expect(() => getDB()).toThrow();
    expect(() => getEnv()).toThrow();
  });

  it('lets background work run on its own', async () => {
    let done = false;
    runInBackground(
      Promise.resolve().then(() => {
        done = true;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('logs background work that fails rather than letting it escape', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    runInBackground(Promise.reject(new Error('boom')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toHaveBeenCalledWith(
      'background task failed',
      expect.any(Error),
    );
    log.mockRestore();
  });
});

describe('with a Cloudflare context', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("hands out the context's D1 binding and environment", () => {
    const { d1 } = sqliteD1();
    restore = installCloudflareContext(d1, { SECRET: 'value' });
    expect(getDB()).toBe(d1);
    expect(getEnv()).toMatchObject({ SECRET: 'value', DB: d1 });
    expect(isDatabaseBound()).toBe(true);
  });
});
