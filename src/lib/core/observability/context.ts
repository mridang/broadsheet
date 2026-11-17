/**
 * @packageDocumentation
 *
 * Application context for Workers Issues. Cloudflare shows the attributes set
 * on the invocation's root span next to an error, so an error can say who and
 * what it affected. Everything here is best effort: where there is no Workers
 * runtime (plain Node, tests) or no active span, it does nothing, and it never
 * throws.
 *
 * Only plain facts go in: an internal user number, the kind of sign-in, a
 * fixed reason code. Never an email address, a name, an address, a cookie, a
 * token, a code or any text from a request or from Google.
 */

/** What a span attribute may hold. */
export type ContextValue = string | number | boolean;

/** Attributes to set; those left undefined are dropped. */
export type ContextAttributes = Readonly<
  Record<string, ContextValue | undefined>
>;

/** The part of a Workers span this file uses. */
interface ContextSpan {
  setAttribute(key: string, value: ContextValue): void;
  recordException(exception: { name: string; message: string }): void;
}

/** The part of `tracing` from `cloudflare:workers` this file uses. */
interface ContextTracing {
  getActiveSpan(): ContextSpan | undefined;
}

/** Longest text kept in one attribute; the rest is cut off. */
const MAX_TEXT = 256;

/** The tracing API once loaded; `null` where there is none. */
// eslint-disable-next-line functional/no-let -- a module-level cache of the loaded tracing API, set once the module has loaded
let loaded: ContextTracing | null | undefined;

/**
 * Load `cloudflare:workers`. Only the loaded module is remembered, never the
 * promise: a promise started in one request must not be waited on in another,
 * which the Workers runtime may never settle. The module is lazy because it
 * exists only in the Workers runtime, and a failure is remembered. The ignore
 * comments keep the app's bundlers from trying to resolve it.
 */
async function load(): Promise<ContextTracing | null> {
  return import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ 'cloudflare:workers'
  )
    .then((workers) => (loaded = workers.tracing))
    .catch(() => (loaded = null));
}

/**
 * Run `apply` on the invocation's root span, if there is one. Once the runtime
 * module has loaded this happens at once, before the call returns, so that
 * context set in a handler that does not wait is still on the span when the
 * invocation ends. Never rejects.
 */
async function withActiveSpan(
  apply: (span: ContextSpan) => void,
): Promise<void> {
  const run = (tracing: ContextTracing | null): void => {
    try {
      const span = tracing?.getActiveSpan();
      if (span) {
        apply(span);
      }
    } catch {
      // Context is a convenience: it must never fail a request.
    }
  };
  if (loaded !== undefined) {
    run(loaded);
    return;
  }
  await load()
    .then(run)
    .catch(() => undefined);
}

/** The attributes worth keeping: defined, and a string, a finite number or a boolean. */
function accepted(attributes: ContextAttributes): [string, ContextValue][] {
  return Object.entries(attributes).flatMap(
    ([key, value]): [string, ContextValue][] => {
      if (typeof value === 'string') {
        return [[key, value.slice(0, MAX_TEXT)]];
      }
      // Anything else (undefined, objects, non-finite numbers) is dropped.
      return typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
        ? [[key, value]]
        : [];
    },
  );
}

/**
 * Attach attributes to the current invocation so an error in it shows them.
 * Safe to call anywhere, any number of times (a later call for the same key
 * replaces the earlier value). The first call has to load the runtime module,
 * so where the caller is async it should wait for the result; the returned
 * promise never rejects.
 */
export async function setErrorContext(
  attributes: ContextAttributes,
): Promise<void> {
  try {
    const kept = accepted(attributes);
    if (kept.length === 0) {
      return;
    }
    await withActiveSpan((span) => {
      // eslint-disable-next-line functional/no-loop-statements -- the loop only reports each attribute to the span
      for (const [key, value] of kept) {
        span.setAttribute(key, value);
      }
    });
  } catch {
    // Context is a convenience: it must never fail a request.
  }
}

/**
 * Record an error on the current invocation's span so Issues groups it by
 * `name`. Only the two fixed words are sent, never text that came from a
 * request, a person or a provider.
 */
export async function recordErrorOnSpan(
  name: string,
  message: string,
): Promise<void> {
  return withActiveSpan((span) =>
    span.recordException({
      name: name.slice(0, MAX_TEXT),
      message: message.slice(0, MAX_TEXT),
    }),
  );
}
