/**
 * One of the signed-in person's classifiers.
 *
 *   DELETE /api/users/self/classifiers/:id → 204
 *
 * The behaviour lives in the `classifierItem` controller; this file only
 * mounts it.
 */

import { classifierItem } from '@/domain/api/classifiers';

export const dynamic = 'force-dynamic';

export const { DELETE } = classifierItem.handlers();
