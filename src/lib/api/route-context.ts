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
