/**
 * One import of feeds, as it runs.
 *
 *   GET /api/feeds/imports/:id → 200 with its progress and what it did so far.
 *
 * The behaviour lives in the `feedImportItem` controller; this file only mounts it.
 */

import { feedImportItem } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { GET } = feedImportItem.handlers();
