/**
 * A person's saves, a section or their edition as Atom, for feed readers.
 *
 *   GET /feed.xml?token= → 200 application/atom+xml
 *
 * A protocol endpoint outside `/api`; the behaviour lives in `serveFeed`.
 */

import { getDatabase } from '@/domain/db/database';
import { serveFeed } from '@/domain/feed-out';
import { appOrigin } from '@/lib/core/origin';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return serveFeed(request, getDatabase(), appOrigin(request));
}
