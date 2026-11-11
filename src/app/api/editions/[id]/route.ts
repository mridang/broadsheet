/**
 * One of the signed-in person's custom editions. The pages read editions on
 * the server, so only changing and removing one is offered.
 *
 *   PATCH  /api/editions/:id {name?, section_ids?, query?, tag?} → 200
 *   DELETE /api/editions/:id                                     → 204.
 *
 * The behaviour lives in the `editionItem` controller; this file only mounts
 * it.
 */

import { editionItem } from '@/domain/api/editions';

export const dynamic = 'force-dynamic';

export const { PATCH, DELETE } = editionItem.handlers();
