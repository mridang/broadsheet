/**
 * One of the signed-in person's sections. The page lists sections on the
 * server, so only changing and removing one is offered.
 *
 *   PATCH  /api/sections/:id {name?, position?} → 200
 *   DELETE /api/sections/:id                    → 204
 *
 * The behaviour lives in the `sectionItem` controller; this file only mounts
 * it.
 */

import { sectionItem } from '@/domain/api/sections';

export const dynamic = 'force-dynamic';

export const { PATCH, DELETE } = sectionItem.handlers();
