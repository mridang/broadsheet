/**
 * @packageDocumentation
 *
 * The consent-screen decision, apart from the route so it can take an
 * injected {@link CurrentUserResolver} and store (a Next route export may
 * not). Everything is checked again here, since the form fields are
 * untrusted, and the browser must be signed in with a live session.
 */

import {
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import { readFormBody } from '@/lib/core/api';
import { appOrigin } from '@/lib/core/origin';
import {
  MAX_OAUTH_FORM_BYTES,
  authorizeParamsFrom,
  issueAuthorizationCode,
  redirectWith,
  validateAuthorizeRequest,
  type OAuthStore,
} from '@/lib/oauth';
import { isSameOriginPost } from '@/lib/web-security';

/** A plain-text refusal. */
const refuse = (message: string, status: number): Response =>
  new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

/** A 303 to the client's verified redirect URI. */
const back = (location: string): Response =>
  new Response(null, { status: 303, headers: { Location: location } });

/**
 * `POST /oauth/consent`: 303 back to the app's redirect URI with a `code` on
 * approval or `error=access_denied` on cancel; 400 when the client or its
 * redirect URI cannot be trusted or the form is unreadable; 401 when nobody
 * is signed in; 403 for a cross-site post; 413 for a form over 16 KiB.
 */
export async function handleConsent(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
  store: () => OAuthStore = () => new D1OAuthStore(getDatabase()),
): Promise<Response> {
  const origin = appOrigin(request);
  if (!isSameOriginPost(request.headers, origin)) {
    return refuse('Cross-site request refused.', 403);
  }
  // The live check: a token outlives the browser session, so a session the
  // person has ended must not be able to approve.
  const uid = await resolver.currentLiveUid(request);
  if (uid === null) {
    return refuse('Sign in first.', 401);
  }
  const body = await readFormBody(request, MAX_OAUTH_FORM_BYTES);
  if (body.kind === 'too-large') {
    return refuse('The form is too large.', 413);
  }
  if (body.kind !== 'ok') {
    return refuse('The form could not be read.', 400);
  }
  const oauth = store();
  const check = await validateAuthorizeRequest(
    authorizeParamsFrom(body.form),
    origin,
    (id) => oauth.findClient(id),
  );
  if (!check.ok) {
    return check.redirect
      ? back(
          redirectWith(check.redirect.uri, {
            error: check.error,
            error_description: check.description,
            state: check.redirect.state,
            iss: origin,
          }),
        )
      : refuse(check.description, 400);
  }
  const { redirectUri, state } = check.request;
  if (body.form.get('decision') !== 'approve') {
    return back(
      redirectWith(redirectUri, { error: 'access_denied', state, iss: origin }),
    );
  }
  const code = await issueAuthorizationCode(
    oauth,
    check.request,
    uid,
    Math.floor(Date.now() / 1000),
  );
  return back(redirectWith(redirectUri, { code, state, iss: origin }));
}
