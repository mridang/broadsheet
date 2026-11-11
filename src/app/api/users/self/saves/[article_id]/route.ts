/* eslint-disable-line unicorn/filename-case -- the framework requires this dynamic route segment name */
/**
 * The signed-in person's save of one story.
 *
 * POST   /api/users/self/saves/:article_id {tags?} → 201 + Location
 *   DELETE /api/users/self/saves/:article_id         → 204.
 *
 * The behaviour lives in the `saveItem` controller; this file only mounts
 * it.
 */

import { saveItem } from '@/domain/api/saves';

export const dynamic = 'force-dynamic';

export const { POST, DELETE } = saveItem.handlers();
