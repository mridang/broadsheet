/**
 * @packageDocumentation
 *
 * The second argument Next.js hands a route handler whose path has a dynamic
 * segment: the segment values, as a promise (they are read with `await`).
 */

/** For paths ending in `[id]`, such as `/api/recipes/:id`. */
export interface IdContext {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * The second argument Next hands any route handler: the dynamic segments, as a
 * promise, or nothing for a static path. The controller framework passes it
 * through to each endpoint's context builder.
 */
export interface RouteContext {
  readonly params?: Promise<Readonly<Record<string, string>>>;
}
