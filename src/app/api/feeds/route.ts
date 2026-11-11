/**
 * The feeds the signed-in person follows.
 *
 *   GET  /api/feeds → a page of JSON, or OPML for `Accept: text/x-opml`
 *   POST /api/feeds {url} → 201 + Location (200 + Location when they
 *                           already follow it).
 *
 * The behaviour lives in the `feedsCollection` controller; this file only
 * mounts it.
 */

import { feedsCollection } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { GET, POST } = feedsCollection.handlers();
