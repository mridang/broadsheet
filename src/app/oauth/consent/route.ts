/**
 * Receives the Approve / Cancel decision from the consent screen. Everything is
 * validated again here (the form fields are untrusted), and the browser must be
 * signed in. Approving mints a single-use authorization code and sends the user
 * back to the app's redirect URI; cancelling sends back `access_denied`.
 *
 * The logic lives in {@link handleConsent} (so it can take an injected
 * resolver); this file only mounts it.
 */

import { handleConsent } from './handler';

/** `POST /oauth/consent`: the decision from the approval screen. */
export async function POST(request: Request): Promise<Response> {
  return handleConsent(request);
}
