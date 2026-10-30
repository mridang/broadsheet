import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { installFakeTracing } from './fake-tracing';

const fake = installFakeTracing();
const { recordErrorOnSpan, setErrorContext } =
  await import('@/lib/core/observability/context');

beforeEach(() => {
  for (const key of Object.keys(fake.attributes)) {
    delete fake.attributes[key];
  }
  fake.exceptions.length = 0;
  fake.active = true;
  fake.throwing = false;
});

describe('setErrorContext', () => {
  it('sets strings, numbers and booleans on the active span', async () => {
    await setErrorContext({ 'user.id': 4, 'auth.method': 'session', ok: true });
    expect(fake.attributes).toEqual({
      'user.id': 4,
      'auth.method': 'session',
      ok: true,
    });
  });

  it('drops undefined values and anything that is not a plain value', async () => {
    await setErrorContext({
      gone: undefined,
      nan: Number.NaN,
      object: { a: 1 } as never,
      kept: 'yes',
    });
    expect(fake.attributes).toEqual({ kept: 'yes' });
  });

  it('cuts long text', async () => {
    await setErrorContext({ long: 'x'.repeat(1000) });
    expect(String(fake.attributes['long'])).toHaveLength(256);
  });

  it('does nothing where there is no active span', async () => {
    fake.active = false;
    await expect(setErrorContext({ a: 1 })).resolves.toBeUndefined();
    expect(fake.attributes).toEqual({});
  });

  it('never throws, even when the span does', async () => {
    fake.throwing = true;
    await expect(setErrorContext({ a: 1 })).resolves.toBeUndefined();
  });
});

describe('recordErrorOnSpan', () => {
  it('records the exception on the active span', async () => {
    await recordErrorOnSpan('LoggedError', 'auth.callback.failed');
    expect(fake.exceptions).toEqual([
      { name: 'LoggedError', message: 'auth.callback.failed' },
    ]);
  });

  it('does nothing without an active span and never throws', async () => {
    fake.active = false;
    await expect(recordErrorOnSpan('A', 'b')).resolves.toBeUndefined();
    fake.active = true;
    fake.throwing = true;
    await expect(recordErrorOnSpan('A', 'b')).resolves.toBeUndefined();
  });
});

describe('without the Workers runtime (plain Node, tests)', () => {
  it('does nothing and does not throw', async () => {
    jest.unstable_unmockModule('cloudflare:workers');
    jest.resetModules();
    const bare = await import('@/lib/core/observability/context');
    await expect(bare.setErrorContext({ a: 1 })).resolves.toBeUndefined();
    await expect(bare.recordErrorOnSpan('A', 'b')).resolves.toBeUndefined();
    expect(fake.attributes).toEqual({});
  });
});
