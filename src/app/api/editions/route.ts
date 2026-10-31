/**
 * The custom editions the signed-in person keeps beside their default one.
 *
 *   POST /api/editions {name, section_ids?, query?, tag?} → 201 + Location
 *
 * The behaviour lives in the `editionsCollection` controller; this file only
 * mounts it.
 */

import { editionsCollection } from '@/domain/api/editions';

export const dynamic = 'force-dynamic';

export const { POST } = editionsCollection.handlers();
