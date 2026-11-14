/**
 * @packageDocumentation
 *
 * Validating an authorization request (`/oauth/authorize`). The order of the
 * checks matters: until the client and its redirect URI are verified we must
 * NOT redirect anywhere (an attacker could use us as an open redirect), so
 * those errors are shown to the user. Once they are verified, every other
 * problem is reported to the client by redirecting back with an `error`.
 */

import type { FormFields } from '@/lib/oauth/http';
import {
  MAX_CLIENT_ID_LENGTH,
  isClientBusy,
  type ClientBusy,
  type OAuthClient,
} from '@/lib/oauth/client';
import { isWellFormedChallenge } from '@/lib/oauth/pkce';
import { isOurResource, resourceUri } from '@/lib/oauth/metadata';
import {
  isAcceptableRedirectUri,
  redirectUriMatches,
} from '@/lib/oauth/redirect-uri';
import { SCOPE_READ, normaliseScope, type Scope } from '@/lib/oauth/scopes';
import { logSecurityEvent } from '@/lib/oauth/security-log';
import { SITE_NAME } from '@/utils/site';
import { withQueryParams } from '@/utils/query';
import { countOf } from '@/lib/intl';

/** A validated authorization request. */
export interface AuthorizeRequest {
  readonly client: OAuthClient;
  readonly redirectUri: string;
  /** Whether the request named the redirect address (as opposed to the client's only one being assumed). */
  readonly redirectUriSent: boolean;
  readonly state: string | undefined;
  readonly codeChallenge: string;
  readonly scope: readonly Scope[];
  readonly resource: string;
}

/** The result of validating one. */
export type AuthorizeCheck =
  | { readonly ok: true; readonly request: AuthorizeRequest }
  | {
      readonly ok: false;
      /** OAuth error code. */
      readonly error: string;
      readonly description: string;

      /**
       * Set when the problem is "too busy right now" rather than a bad request:
       * seconds to wait before trying again (a 429 where the caller can send one).
       */
      readonly retryAfterSeconds?: number;

      /**
       * Where to send the error. Absent when the client or redirect URI could
       * not be trusted, in which case the error is shown to the user instead.
       */
      readonly redirect?: {
        readonly uri: string;
        readonly state: string | undefined;

        /**
         * Whether the error may be sent there without the person choosing to go.
         * True only for a client whose redirect addresses come from a document
         * its own domain published; an anonymously registered client picked its
         * addresses itself, so redirecting to one before the person has seen
         * anything would make this server an open redirector for phishing
         * (MCP security considerations, "Open Redirection").
         */
        readonly automatic: boolean;
      };
    };

/** The names of the parameters of an authorization request, in the order they are passed along. */
export const AUTHORIZE_FIELDS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
] as const;

/** The query/form parameters we read. */
export type AuthorizeParams = Readonly<Record<string, string | undefined>>;

/** The authorization parameters present in a submitted form (text fields only; files and unknown fields are ignored). */
export function authorizeParamsFrom(form: FormFields): AuthorizeParams {
  return Object.fromEntries(
    AUTHORIZE_FIELDS.flatMap((name): [string, string][] => {
      const value = form.get(name);
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

/**
 * The scopes to grant once the person has chosen how much to allow. `choice` is
 * the consent form's `access` field: `read` narrows whatever was asked for to
 * read-only, anything else (including no choice, as from a form posted before
 * the choice existed) grants what was asked. Never grants more than asked.
 */
export function grantedScope(
  requested: readonly Scope[],
  choice: string | null | undefined,
): readonly Scope[] {
  return choice === 'read' ? [SCOPE_READ] : requested;
}

/**
 * Check an authorization request against the client registry.
 * `resolveClient` looks a client up (fetching its metadata document if needed).
 */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  origin: string,
  resolveClient: (
    clientId: string,
  ) => Promise<OAuthClient | ClientBusy | undefined>,
): Promise<AuthorizeCheck> {
  const clientId = params['client_id'];
  if (!clientId) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'The request has no client_id.',
    };
  }
  if (clientId.length > MAX_CLIENT_ID_LENGTH) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'The client_id is too long.',
    };
  }
  const client = await resolveClient(clientId);
  if (isClientBusy(client)) {
    logSecurityEvent('oauth.rate_limited', {
      endpoint: 'authorize',
      retryAfterSeconds: client.retryAfterSeconds,
    });
    return {
      ok: false,
      error: 'temporarily_unavailable',
      description: `Too many applications are being checked right now. Try again in ${countOf(client.retryAfterSeconds, 'second')}.`,
      retryAfterSeconds: client.retryAfterSeconds,
    };
  }
  if (!client) {
    // The id is the caller's own text: cut it short so a log line stays small.
    logSecurityEvent('oauth.invalid_client', {
      clientId: clientId.slice(0, 200),
    });
    return {
      ok: false,
      error: 'invalid_client',
      description: `This application is not known to ${SITE_NAME}.`,
    };
  }

  // A client with one registered URI may omit it; otherwise it must match.
  const requested = params['redirect_uri'];
  const redirectUri =
    requested ??
    (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'The request has no redirect_uri.',
    };
  }
  // A copy of the client saved before the redirect rules tightened may still
  // list an address we would no longer accept; it is refused here too.
  if (
    !isAcceptableRedirectUri(redirectUri) ||
    !redirectUriMatches(redirectUri, client.redirectUris)
  ) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'The redirect_uri is not one this application registered.',
    };
  }

  // From here on the redirect target is trusted, so report errors to the client.
  const state = params['state'];
  const fail = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    error,
    description,
    redirect: { uri: redirectUri, state, automatic: client.kind === 'cimd' },
  });

  if (params['response_type'] !== 'code') {
    return fail(
      'unsupported_response_type',
      'Only response_type=code is supported.',
    );
  }
  const codeChallenge = params['code_challenge'];
  if (!codeChallenge || params['code_challenge_method'] !== 'S256') {
    return fail(
      'invalid_request',
      'PKCE with code_challenge_method=S256 is required.',
    );
  }
  if (!isWellFormedChallenge(codeChallenge)) {
    return fail(
      'invalid_request',
      'The code_challenge is not a valid S256 challenge.',
    );
  }
  const resource = params['resource'];
  if (resource !== undefined && !isOurResource(resource, origin)) {
    return fail('invalid_target', 'The resource is not this MCP server.');
  }
  const scope = normaliseScope(params['scope']);
  if (scope.length === 0) {
    return fail('invalid_scope', 'None of the requested scopes are supported.');
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      redirectUriSent: requested !== undefined,
      state,
      codeChallenge,
      scope,
      resource: resourceUri(origin),
    },
  };
}

/** Add parameters to a redirect URI, keeping any query it already has. */
export function redirectWith(
  uri: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  // Parameters with no value are left out rather than sent empty.
  const given = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]): [string, string][] =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  return withQueryParams(uri, given);
}
