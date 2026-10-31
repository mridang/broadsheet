/**
 * Receives the Approve / Cancel decision from the consent screen. The logic
 * lives in {@link handleConsent}; this file only mounts it.
 */

import { handleConsent } from './handler';

/** `POST /oauth/consent`: the decision from the approval screen. */
export async function POST(request: Request): Promise<Response> {
  return handleConsent(request);
}
