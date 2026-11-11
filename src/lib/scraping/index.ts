/**
 * @packageDocumentation
 *
 * The pure HTML/feed scraping codec: parse a feed, pull og:image, description
 * and site name from an article page, and the scraped-item shape. No I/O of its
 * own beyond what the caller passes in.
 */
export {
  articleText,
  decode,
  domainClean,
  extractPoints,
  feedDetails,
  type FeedDetails,
  type FeedElement,
  type FeedFormat,
  feedHeader,
  hostOf,
  isBoilerplate,
  itemAuthor,
  itemImage,
  itemTags,
  ogImage,
  pageDescription,
  parseFeed,
  siteName,
} from './parse';
export { type ScrapedItem } from './types';
export {
  feedCandidates,
  feedScore,
  isFeed,
  retryAfterMinutes,
} from './discover';
export {
  distinctStories,
  type FeedActivity,
  fetchIntervalMinutes,
  maxAgeMinutes,
  NOTIFIED_INTERVAL_MINUTES,
  sameStory,
  similarity,
  withJitter,
} from './stories';
export {
  LEASE_SECONDS,
  signatureMatches,
  webSubLinks,
  type WebSubLinks,
} from './websub';
