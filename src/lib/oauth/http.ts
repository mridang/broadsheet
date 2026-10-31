/**
 * @packageDocumentation
 *
 * Small HTTP helpers shared by the OAuth and MCP route handlers: CORS (browser
 * based assistants call these endpoints cross-origin), JSON error bodies in the
 * OAuth shape, and reading the bearer token.
 */

import { readFormBody, type FormBody } from '@/lib/core/api';

/**
 * CORS for endpoints a browser-based client may call. `Retry-After` and the
 * challenge are exposed so a page can react to them.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Retry-After',
  'Access-Control-Max-Age': '86400',
};

/** The reply to a CORS preflight. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * A JSON response that must never be cached or stored. RFC 6749 §5.1 asks for
 * both `Cache-Control: no-store` and `Pragma: no-cache` on token responses.
 */
export function noStoreJson(
  body: unknown,
  status = 200,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...extra,
    },
  });
}

/** An OAuth error response (RFC 6749 §5.2). */
export function oauthError(
  error: string,
  description: string,
  status = 400,
): Response {
  return noStoreJson({ error, error_description: description }, status);
}

/** The token from an `Authorization: Bearer …` header, if present. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1];
}

/** The most a token, revocation or consent form may weigh. */
export const MAX_OAUTH_FORM_BYTES = 16_384;

/** What reading an OAuth form request came to: the form, or why it could not be used. */
export type OAuthForm = FormBody | { readonly kind: 'wrong-type' };

/**
 * Read a request body as the URL-encoded form OAuth requires (RFC 6749 §3.2),
 * refusing a different declared content type and anything over
 * {@link MAX_OAUTH_FORM_BYTES}. A request that declares no type is read as a form.
 */
export async function readOAuthForm(request: Request): Promise<OAuthForm> {
  const type = request.headers.get('content-type')?.toLowerCase();
  if (type && !type.startsWith('application/x-www-form-urlencoded')) {
    return { kind: 'wrong-type' };
  }
  return readFormBody(request, MAX_OAUTH_FORM_BYTES);
}

/** The OAuth error response for a form that could not be used. */
export function formFailure(
  form: Exclude<OAuthForm, { readonly kind: 'ok' }>,
): Response {
  switch (form.kind) {
    case 'wrong-type':
      return oauthError(
        'invalid_request',
        'Send the request as application/x-www-form-urlencoded.',
      );
    case 'too-large':
      return oauthError('invalid_request', 'The request is too large.');
    case 'unreadable':
      return oauthError('invalid_request', 'The request body is not readable.');
  }
}
