/**
 * The signed-in person's preferences for clustering and the editor's note.
 *
 *   GET   /api/users/self/preferences → 200
 *   PATCH /api/users/self/preferences → 200
 *
 * The behaviour lives in the `preferencesItem` controller; this file only
 * mounts it.
 */

import { preferencesItem } from '@/domain/api/preferences';

export const dynamic = 'force-dynamic';

export const { GET, PATCH } = preferencesItem.handlers();
