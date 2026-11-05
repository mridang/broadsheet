/**
 * The old address of a source's WebSub callback, kept as a deliberate alias.
 *
 * The callback now lives at `/webhooks/sources/{id}`, outside the REST
 * contract. Hubs that subscribed before the move hold this address as the
 * callback they verify and push to, until their lease is renewed with the new
 * one, so it keeps answering exactly as the new route does. It is not in
 * `openapi.json`. Remove it once no source has a lease granted before the move.
 */

export { GET, POST } from '@/app/webhooks/sources/[id]/route';

export const dynamic = 'force-dynamic';
