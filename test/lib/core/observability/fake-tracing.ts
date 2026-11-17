import { jest } from '@jest/globals';

/** What a fake span was told. */
export interface FakeTracing {
  /** The attributes set on the active span. */
  readonly attributes: Record<string, unknown>;
  /** The exceptions recorded on the active span. */
  readonly exceptions: readonly { name: string; message: string }[];
  /** Whether there is an active span (there is none outside a request). */
  readonly active: boolean;
  /** Whether the fake span throws from every call. */
  readonly throwing: boolean;
  /** Forget everything the span was told, and make it active and healthy again. */
  readonly reset: () => void;
  /** Say whether there is an active span. */
  readonly setActive: (active: boolean) => void;
  /** Make the fake span throw from every call, or stop doing so. */
  readonly setThrowing: (throwing: boolean) => void;
}

/** What the fake span has been told so far, replaced whole by a reset. */
interface SpanState {
  attributes: Record<string, unknown>;
  exceptions: { name: string; message: string }[];
  active: boolean;
  throwing: boolean;
}

/**
 * Stand in for `cloudflare:workers`, which exists only in the Workers runtime.
 * Call it before importing the code under test; the returned object shows what
 * that code put on the active span.
 */
export function installFakeTracing(): FakeTracing {
  const state: SpanState = {
    attributes: {},
    exceptions: [],
    active: true,
    throwing: false,
  };
  const span = {
    setAttribute(key: string, value: unknown) {
      if (state.throwing) {
        throw new Error('span failed');
      }
      state.attributes[key] = value;
    },
    recordException(exception: { name: string; message: string }) {
      if (state.throwing) {
        throw new Error('span failed');
      }
      state.exceptions.push(exception);
    },
  };
  // eslint-disable-next-line tslop/no-module-mocking -- cloudflare:workers is a runtime-only module that does not exist under Node, so it must be supplied virtually
  jest.unstable_mockModule(
    'cloudflare:workers',
    () => ({
      tracing: { getActiveSpan: () => (state.active ? span : undefined) },
    }),
    { virtual: true },
  );
  return {
    get attributes() {
      return state.attributes;
    },
    get exceptions() {
      return state.exceptions;
    },
    get active() {
      return state.active;
    },
    get throwing() {
      return state.throwing;
    },
    reset: () => {
      Object.assign(state, {
        attributes: {},
        exceptions: [],
        active: true,
        throwing: false,
      });
    },
    setActive: (active) => {
      Object.assign(state, { active });
    },
    setThrowing: (throwing) => {
      Object.assign(state, { throwing });
    },
  };
}
