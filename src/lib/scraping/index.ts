/**
 * @packageDocumentation
 *
 * The pure HTML/feed scraping codec: parse a feed, pull og:image, description
 * and site name from an article page, and the scraped-item shape. No I/O of its
 * own beyond what the caller passes in.
 */
export * from './parse';
export * from './types';
