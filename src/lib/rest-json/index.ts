/**
 * @packageDocumentation
 *
 * Pure REST/JSON primitives shared by the API: RFC 9457 problem responses, the
 * standard problem catalogue, size- and type-checked body reading, and the
 * client-side helper that turns a problem response into a message. No framework
 * dependency — the `core/api` controller builds on these.
 */
export * from './problem';
export * from './json';
export * from './body';
export * from './problem-message';
