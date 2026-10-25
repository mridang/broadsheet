/**
 * @packageDocumentation
 *
 * The REST/JSON layer for the API, in one package: the pure primitives — RFC
 * 9457 problem responses and the standard catalogue, size- and type-checked
 * body reading, and the client-side problem-to-message helper — and the
 * Next-aware ApiController that wires typed endpoints to them. ApiController is
 * the composition entry; the primitives are exported for the handlers that
 * build on them and for the browser code that reads the responses.
 */
export * from './problem';
export * from './problem-message';
export * from './json';
export * from './body';
export * from './controller';
export * from './route-context';
