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
export { problem, problems, type ProblemBody } from './problem';
export {
  readJson,
  readJsonObject,
  isObject,
  type Body,
  type ObjectBody,
} from './json';
export {
  readBodyText,
  readJsonBody,
  readFormBody,
  type TextBody,
  type JsonBody,
  type FormBody,
} from './body';
export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  decodeCursor,
  parseLimit,
  sliceAfter,
  type CursorPosition,
  type Slice,
} from './pagination';
export { entityTag, ifMatchSatisfied, ifNoneMatchHit } from './etag';
export { ok, created, accepted, noContent, page } from './results';
export {
  ApiController,
  type ApiControllerOptions,
  type ApiResponse,
  type Endpoint,
  type HttpMethod,
  type RouteHandler,
} from './controller';
export { type IdContext, type RouteContext } from './route-context';
