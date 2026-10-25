/**
 * @packageDocumentation
 *
 * The success vocabulary an endpoint's `encode` returns to say *what happened*,
 * the mirror of what `problems.*` is for failure. An endpoint builds one of
 * these and the controller renders the HTTP in one place: `ok` a body, `created`
 * a resource at a location (201 plus an absolute `Location` header the
 * controller derives from the request origin), `noContent` an empty 204, or
 * `page` one page of a list (the controller builds the `{ self, next, items }`
 * body and its cursor links). No endpoint hand-assembles a status, a `Location`
 * or a page URL any more.
 */

import type { ApiResponse } from './controller';
import type { CursorPosition } from './pagination';

/** Extra response headers, the one thing every result may carry. */
type Headers = Readonly<Record<string, string>>;

/**
 * A 200 with a JSON `body`. `location` (a path on this app) adds an absolute
 * `Location` header without changing the status — for an idempotent create that
 * returns the resource that already existed.
 */
export function ok<T>(
  body: T,
  options: { readonly headers?: Headers; readonly location?: string } = {},
): ApiResponse<T> {
  return { body, headers: options.headers, location: options.location };
}

/**
 * A 201 for a resource just created. `location` is a path on this app (such as
 * `/api/feeds/42`); the controller turns it into an absolute `Location` header
 * against the app's public origin, so handlers never build the URL themselves.
 */
export function created<T>(
  body: T,
  location: string,
  headers?: Headers,
): ApiResponse<T> {
  return { status: 201, body, location, headers };
}

/** An empty 204, for a request that succeeded with nothing to return. */
export function noContent(headers?: Headers): ApiResponse<never> {
  return { status: 204, headers };
}

/**
 * One page of a list. The controller builds the response body
 * (`{ self, next?, items }`) and the `self`/`next` links from the request and
 * `next` cursor, so paging URLs live in the framework, not the handler.
 */
export function page<T>(
  items: readonly T[],
  next?: CursorPosition,
  headers?: Headers,
): ApiResponse<unknown> {
  return { page: { items, next }, headers };
}
