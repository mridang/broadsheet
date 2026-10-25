/**
 * @packageDocumentation
 *
 * The shared HTTP client primitives every API client is built on: the
 * {@link Result} of a call, the {@link JsonClient} that fetches and
 * Zod-decodes, and the {@link ApiModel} base its models extend.
 */

export type { Result } from './result';
export { JsonClient } from './json-client';
export type { JsonRequest } from './json-client';
export type { ApiModel } from './api-model';
