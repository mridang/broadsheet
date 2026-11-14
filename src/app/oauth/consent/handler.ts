/**
 * @packageDocumentation
 *
 * The consent-screen decision handler, apart from the route so it can take an
 * injected {@link CurrentUserResolver} (a Next route export may not). The route
 * is a thin delegate; tests drive this with a fake resolver.
 */

import { NextResponse } from 'next/server';

import {
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { D1OAuthStore, resolveClient } from '@/domain/db/oauth';
import { readFormBody } from '@/lib/core/api';
import {
  MAX_OAUTH_FORM_BYTES,
  authorizeParamsFrom,
  clientAddress,
  grantedScope,
  issueAuthorizationCode,
  logSecurityEvent,
  redirectWith,
  validateAuthorizeRequest,
} from '@/lib/oauth';
import { isSameOriginPost } from '@/lib/web-security';
import { getDatabase } from '@/domain/db/client';
import { appOrigin } from '@/lib/core/origin';

/** A plain-text error page response, with a `Retry-After` when the caller should wait. */
const refuse = (
  message: string,
  status: number,
  retryAfterSeconds?: number,
): Response =>
  new NextResponse(message, {
    status,
    headers:
      retryAfterSeconds === undefined
        ? undefined
        : { 'Retry-After': String(retryAfterSeconds) },
  });

/**
 * The decision from the approval screen. Needs a signed-in browser and a
 * same-origin form post. Answers 303 back to the app's verified redirect
 * address (with a `code` on approval, or an `error` when cancelled or when the
 * request has a problem after the address was checked), 400 with a plain
 * message when the client or redirect address cannot be trusted or the form is
 * unreadable, 401 when nobody is signed in, 403 for a cross-site post, 413 for
 * a form over 16 KiB and 429 when too many client metadata documents are being
 * fetched at the moment. An `access` field of `read` approves the app with
 * read-only access even if it asked to edit.
 */
export async function handleConsent(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<Response> {
  const origin = appOrigin(request);
  if (!isSameOriginPost(request.headers, origin)) {
    return refuse('Cross-site request refused.', 403);
  }
  // The live check, not the cookie alone: approving hands out a token that
  // outlives the browser session, so a session the person has ended
  // ("sign out everywhere") must not be able to approve.
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
  const { form } = body;
  const db = getDatabase();
  const address = clientAddress(request.headers);
  const check = await validateAuthorizeRequest(
    authorizeParamsFrom(form),
    origin,
    (id) => resolveClient(db, id, fetch, { origin, address }),
  );
  if (!check.ok) {
    // Only redirect when the redirect target was verified.
    if (check.redirect) {
      return NextResponse.redirect(
        redirectWith(check.redirect.uri, {
          error: check.error,
          error_description: check.description,
          state: check.redirect.state,
          iss: origin,
        }),
        303,
      );
    }
    return check.retryAfterSeconds === undefined
      ? refuse(check.description, 400)
      : refuse(check.description, 429, check.retryAfterSeconds);
  }

  const {
    client,
    redirectUri,
    redirectUriSent,
    state,
    codeChallenge,
    scope: requested,
    resource,
  } = check.request;
  if (form.get('decision') !== 'approve') {
    logSecurityEvent('oauth.consent_denied', {
      clientId: client.clientId,
      userId: uid,
    });
    return NextResponse.redirect(
      redirectWith(redirectUri, { error: 'access_denied', state, iss: origin }),
      303,
    );
  }

  const scope = grantedScope(requested, form.get('access'));
  if (scope.join(' ') !== requested.join(' ')) {
    logSecurityEvent('oauth.scope_narrowed', {
      clientId: client.clientId,
      userId: uid,
      requested: requested.join(' '),
      granted: scope.join(' '),
    });
  }
  const code = await issueAuthorizationCode(
    new D1OAuthStore(db),
    {
      clientId: client.clientId,
      userId: uid,
      redirectUri,
      redirectUriSent,
      codeChallenge,
      scope,
      resource,
    },
    Math.floor(Date.now() / 1000),
  );
  return NextResponse.redirect(
    redirectWith(redirectUri, { code, state, iss: origin }),
    303,
  );
}
