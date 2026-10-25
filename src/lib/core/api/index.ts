/**
 * @packageDocumentation
 *
 * The server-side REST/JSON layer for the API, in one package: the pure
 * primitives — RFC 9457 problem responses and the standard catalogue, size-
 * and type-checked body reading, and the cursor-pagination primitives — the
 * success vocabulary (`ok`/`created`/`noContent`/`page`) a handler returns, and
 * the Next-aware ApiController that wires typed endpoints to them and renders
 * the response. The browser-side helper for reading these responses lives in
 * `@/components/api`, not here.
 */
export * from './problem';
export * from './json';
export * from './body';
export * from './pagination';
export * from './etag';
export * from './results';
export * from './controller';
export * from './route-context';
