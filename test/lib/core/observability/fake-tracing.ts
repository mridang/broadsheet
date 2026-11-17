import { jest } from '@jest/globals';

/** What a fake span was told. */
export interface FakeTracing {
  /** The attributes set on the active span. */
  readonly attributes: Record<string, unknown>;
  /** The exceptions recorded on the active span. */
  readonly exceptions: { name: string; message: string }[];
  /** Whether there is an active span (there is none outside a request). */
  active: boolean;
  /** Make the fake span throw from every call. */
  throwing: boolean;
}

/**
 * Stand in for `cloudflare:workers`, which exists only in the Workers runtime.
 * Call it before importing the code under test; the returned object shows what
 * that code put on the active span.
 */
export function installFakeTracing(): FakeTracing {
  const fake: FakeTracing = {
    attributes: {},
    exceptions: [],
    active: true,
    throwing: false,
  };
  const span = {
    setAttribute(key: string, value: unknown) {
      if (fake.throwing) {
        throw new Error('span failed');
      }
      fake.attributes[key] = value;
    },
    recordException(exception: { name: string; message: string }) {
      if (fake.throwing) {
        throw new Error('span failed');
      }
      fake.exceptions.push(exception);
    },
  };
  // eslint-disable-next-line tslop/no-module-mocking -- cloudflare:workers is imported directly by the code under test, which has no injection point; ESM needs the module replaced before the import
  jest.unstable_mockModule(
    'cloudflare:workers',
    () => ({
      tracing: { getActiveSpan: () => (fake.active ? span : undefined) },
    }),
    { virtual: true },
  );
  return fake;
}
