/**
 * @packageDocumentation
 *
 * The typed data layer: the Drizzle schema (the contract every query
 * composes against) and the client factory. A leaf — depends on nothing.
 */

export * from './schema';
export { createDatabase, type Database } from './client';
