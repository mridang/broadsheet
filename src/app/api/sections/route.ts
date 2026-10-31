/**
 * The sections the signed-in person groups their feeds under.
 *
 *   POST /api/sections {name, position?} → 201 + Location
 *
 * The behaviour lives in the `sectionsCollection` controller; this file only
 * mounts it.
 */

import { sectionsCollection } from '@/domain/api/sections';

export const dynamic = 'force-dynamic';

export const { POST } = sectionsCollection.handlers();
