/**
 * Podcasts found by iTunes Search, with their feeds.
 *
 *   GET /api/podcasts?q&limit → 200 page.
 *
 * The behaviour lives in the `podcastsCollection` controller; this file only mounts it.
 */

import { podcastsCollection } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { GET } = podcastsCollection.handlers();
