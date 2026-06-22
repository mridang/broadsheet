/**
 * @packageDocumentation
 *
 * Public barrel for shared utilities. Import these from `@/lib/util`.
 * HTTP concerns (transports, retry) live in `@/lib/transport`, not here.
 */

export { getDB, getEnv } from './runtime';
export { logInfo, logWarn, logError } from './logging';
export type { LogFields, LogLevel } from './logging';
export { safeJsonParse } from './json';
export type { JsonParseResult } from './json';
