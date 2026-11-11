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
export { problem, type ProblemBody, problems } from './problem';
export {
  type Body,
  isObject,
  type ObjectBody,
  readJson,
  readJsonObject,
} from './json';
export {
  type FormBody,
  type JsonBody,
  readBodyText,
  readFormBody,
  readJsonBody,
  type TextBody,
} from './body';
export {
  type CursorPosition,
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  MAX_LIMIT,
  parseLimit,
  type Slice,
  sliceAfter,
} from './pagination';
export { entityTag, ifMatchSatisfied, ifNoneMatchHit } from './etag';
export { accepted, created, noContent, ok, page } from './results';
export {
  ApiController,
  type ApiControllerOptions,
  type ApiResponse,
  type Endpoint,
  type HttpMethod,
  type RouteHandler,
} from './controller';
export { type IdContext, type RouteContext } from './route-context';
