/**
 * @packageDocumentation
 *
 * Reading a request to the token endpoint (`/oauth/token`): which grant it
 * asks for, the form fields that grant needs, and handing them to the right
 * exchange in `token-endpoint.ts`. The route only reads the form and writes the
 * answer; the rules live here, where a fake store can test them.
 */

import {
  assertionSubject,
  fetchJwks,
  verifyClientAssertion,
  type AssertionDeps,
} from '@/lib/oauth/client-auth';
import type { FormFields } from '@/lib/oauth/http';
import { isOurResource } from '@/lib/oauth/metadata';
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  type OAuthFailure,
  type OAuthStore,
  type TokenResponse,
} from '@/lib/oauth/token-endpoint';
import { SITE_NAME } from '@/utils/site';

/** What the endpoint answers with, ready to turn into a response. */
export type TokenRequestResult =
  /** Tokens were issued. */
  | { readonly ok: true; readonly tokens: TokenResponse }
  /** The request was refused; `status` is the HTTP status to send. */
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
      readonly status: 400 | 401;
      /** The `WWW-Authenticate` challenge that must accompany a 401 (RFC 9110 §15.5.2). */
      readonly wwwAuthenticate?: string;
    };

/**
 * What the request said about itself outside the form. A client that sends an
 * `Authorization` header has tried to authenticate; refusing it takes a 401
 * with a challenge (RFC 6749 §5.2), where a request that tried nothing is
 * simply malformed.
 */
export interface TokenRequestContext {
  /** Whether the request had an `Authorization: Basic …` header. */
  readonly basicAuthAttempted?: boolean;
  /** Fetch a client's key set; the real fetch unless a test supplies one. */
  readonly fetchJwks?: AssertionDeps['fetchJwks'];
}

/** The challenge sent with a 401 from the token endpoint. This server only has public clients, so Basic is offered only to say it is not accepted as the way to identify. */
const CLIENT_CHALLENGE = `Basic realm="${SITE_NAME}", charset="UTF-8"`;

/** A form field's text, or undefined when it is missing or empty. */
export function formField(form: FormFields, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Answer one token request. `origin` is this site's public origin (a
 * `resource` in the request must name the MCP server there) and `now` the time
 * in Unix seconds.
 */
export async function handleTokenRequest(
  form: FormFields,
  store: OAuthStore,
  origin: string,
  now: number,
  context: Readonly<TokenRequestContext> = {},
): Promise<TokenRequestResult> {
  const assertion = formField(form, 'client_assertion');
  const clientId =
    formField(form, 'client_id') ??
    (assertion ? assertionSubject(assertion) : undefined);
  if (!clientId) {
    // Every client here is public and names itself with `client_id`. A request
    // that tried to authenticate some other way gets the 401 and challenge the
    // RFC requires; one that simply left the parameter out is malformed.
    return context.basicAuthAttempted
      ? {
          ok: false,
          error: 'invalid_client',
          description: 'Identify the client with the client_id parameter.',
          status: 401,
          wwwAuthenticate: CLIENT_CHALLENGE,
        }
      : {
          ok: false,
          error: 'invalid_request',
          description: 'The request has no client_id.',
          status: 400,
        };
  }
  // A client that declared `private_key_jwt` must sign every request, whatever
  // else it supports: the declared method is never downgraded.
  const client = await store.findClient(clientId);
  const auth = client?.auth;
  const unauthenticated = auth
    ? await verifyClientAssertion(
        auth,
        clientId,
        {
          assertion,
          assertionType: formField(form, 'client_assertion_type'),
        },
        [`${origin}/oauth/token`, origin],
        {
          fetchJwks: context.fetchJwks ?? fetchJwks,
          claimAssertion: (id, jti, expiresAt) =>
            store.claimAssertion(id, jti, expiresAt),
        },
        now,
      )
    : undefined;
  if (unauthenticated) {
    return {
      ok: false,
      error: unauthenticated.error,
      description: unauthenticated.description,
      status: 400,
    };
  }
  const result = await exchange(
    formField(form, 'grant_type'),
    form,
    clientId,
    store,
    origin,
    now,
  );
  return 'ok' in result
    ? {
        ok: false,
        error: result.error,
        description: result.description,
        status: 400,
      }
    : { ok: true, tokens: result };
}

/** An exchange that failed before it began. */
function failure(error: string, description: string): OAuthFailure {
  return { ok: false, error, description };
}

/** Run the exchange the grant type names, or refuse a grant type we do not offer. */
async function exchange(
  grantType: string | undefined,
  form: FormFields,
  clientId: string,
  store: OAuthStore,
  origin: string,
  now: number,
): Promise<TokenResponse | OAuthFailure> {
  if (grantType === 'authorization_code') {
    const code = formField(form, 'code');
    return code
      ? exchangeAuthorizationCode(
          store,
          {
            code,
            clientId,
            redirectUri: formField(form, 'redirect_uri'),
            codeVerifier: formField(form, 'code_verifier'),
            resource: formField(form, 'resource'),
          },
          (resource) => isOurResource(resource, origin),
          now,
        )
      : failure('invalid_request', 'The request has no code.');
  }
  if (grantType === 'refresh_token') {
    const refreshToken = formField(form, 'refresh_token');
    return refreshToken
      ? exchangeRefreshToken(
          store,
          {
            refreshToken,
            clientId,
            scope: formField(form, 'scope'),
            resource: formField(form, 'resource'),
          },
          (resource) => isOurResource(resource, origin),
          now,
        )
      : failure('invalid_request', 'The request has no refresh_token.');
  }
  // A missing parameter is a malformed request (RFC 6749 §5.2); only a grant
  // type that was named and is not offered is "unsupported".
  return grantType === undefined
    ? failure('invalid_request', 'The request has no grant_type.')
    : failure(
        'unsupported_grant_type',
        'Use authorization_code or refresh_token.',
      );
}
