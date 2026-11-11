/**
 * The imports of feeds into the signed-in person's list.
 *
 * POST /api/feeds/imports (OPML file or {topic_ids}) → 201 + Location,
 *                           with what was added, skipped and rejected;
 *                           a large file → 202 + Location of its progress.
 *
 * The behaviour lives in the `feedImports` controller; this file only mounts it.
 */

import { feedImports } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { POST } = feedImports.handlers();
