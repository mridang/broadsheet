/**
 * The signed-in person's listening player.
 *
 * GET    /api/users/self/player → 200
 *   PUT    /api/users/self/player → 200
 *   DELETE /api/users/self/player → 204.
 *
 * The behaviour lives in the `playerItem` controller; this file only mounts
 * it.
 */

import { playerItem } from '@/domain/api/player';

export const dynamic = 'force-dynamic';

export const { GET, PUT, DELETE } = playerItem.handlers();
