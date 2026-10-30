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
  setAttribute(key: string, value: ContextValue): unknown;
  recordException(exception: { name: string; message: string }): unknown;
}

/** The part of `tracing` from `cloudflare:workers` this file uses. */
interface ContextTracing {
  getActiveSpan(): ContextSpan | undefined;
}

/** Longest text kept in one attribute; the rest is cut off. */
const MAX_TEXT = 256;

/**
 * The module's name sits in a variable on purpose: the app's bundlers cannot
 * resolve a `cloudflare:` module, and cannot see through a variable, so they
 * leave the import to the runtime, which has it.
 */
const WORKERS_MODULE: string = 'cloudflare:workers';

/** The tracing API once loaded; `null` where there is none. */
let loaded: ContextTracing | null | undefined;
let loading: Promise<ContextTracing | null> | undefined;

/**
 * Load `cloudflare:workers` the first time it is wanted. It is loaded lazily,
 * and a failure is remembered, because the module only exists in the Workers
 * runtime.
 */
function load(): Promise<ContextTracing | null> {
  loading ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ WORKERS_MODULE
  ).then(
    (workers: { tracing: ContextTracing }) => (loaded = workers.tracing),
    () => (loaded = null),
  );
  return loading;
}

/** The invocation's root span, or undefined where there is none. */
async function activeSpan(): Promise<ContextSpan | undefined> {
  try {
    return (loaded === undefined ? await load() : loaded)?.getActiveSpan();
  } catch {
    return undefined;
  }
}

/** The attributes worth keeping: defined, and a string, a finite number or a boolean. */
function accepted(attributes: ContextAttributes): [string, ContextValue][] {
  const kept: [string, ContextValue][] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string') {
      kept.push([key, value.slice(0, MAX_TEXT)]);
    } else if (typeof value === 'boolean') {
      kept.push([key, value]);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      kept.push([key, value]);
    }
  }
  return kept;
}

/**
 * Attach attributes to the current invocation so an error in it shows them.
 * Safe to call anywhere, any number of times (a later call for the same key
 * replaces the earlier value). Call it with `await` where the caller is async
 * (the first call has to load the runtime module); the returned promise never
 * rejects.
 */
export async function setErrorContext(
  attributes: ContextAttributes,
): Promise<void> {
  try {
    const kept = accepted(attributes);
    if (kept.length === 0) {
      return;
    }
    const span = await activeSpan();
    for (const [key, value] of kept) {
      span?.setAttribute(key, value);
    }
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
  try {
    (await activeSpan())?.recordException({
      name: name.slice(0, MAX_TEXT),
      message: message.slice(0, MAX_TEXT),
    });
  } catch {
    // As above.
  }
}
