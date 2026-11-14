/**
 * @packageDocumentation
 *
 * Small HTTP helpers shared by the OAuth and MCP route handlers: CORS (browser
 * based assistants call these endpoints cross-origin), JSON error bodies in the
 * OAuth shape, and reading the bearer token.
 */

import { readFormBody, type FormBody } from '@/lib/core/api';

/**
 * CORS for endpoints a browser-based client may call. The MCP headers are
 * spelled as the spec writes them (names are case-insensitive to a browser).
 * `Mcp-Session-Id` and `Last-Event-ID` are for clients of the older revisions,
 * which may send them even though this server keeps no sessions or streams;
 * `traceparent`, `tracestate` and `baggage` carry OpenTelemetry trace context.
 * `DELETE` is listed so such a client's attempt to end a session gets our plain
 * 405 instead of a CORS failure. `Retry-After` is exposed so a page can back
 * off when it is rate limited.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Authorization',
    'Content-Type',
    'Accept',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
    'Mcp-Session-Id',
    'Last-Event-ID',
    'traceparent',
    'tracestate',
    'baggage',
  ].join(', '),
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Retry-After',
  'Access-Control-Max-Age': '86400',
};

/** The reply to a CORS preflight. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * A JSON response that must never be cached or stored. RFC 6749 §5.1 asks for
 * both `Cache-Control: no-store` and `Pragma: no-cache` on token responses (the
 * second is for HTTP/1.0 caches), so every response here carries both.
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
  extra: Readonly<Record<string, string>> = {},
): Response {
  return noStoreJson({ error, error_description: description }, status, extra);
}

/** The token from an `Authorization: Bearer …` header, if present. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

/** Anything that looks up a submitted form field by name (`URLSearchParams` and `FormData` both do). */
export type FormFields = Readonly<{ get(name: string): unknown }>;

/** The most a token, revocation or consent form may weigh. Real ones are a few hundred bytes; the PKCE verifier, code and tokens are the bulk. */
export const MAX_OAUTH_FORM_BYTES = 16_384;

/** What reading an OAuth form request came to: the form, or why it could not be used. */
export type OAuthForm = FormBody | { readonly kind: 'wrong-type' };

/**
 * Read a request body as the URL-encoded form OAuth requires (RFC 6749 §3.2 and
 * §5), refusing a different declared content type, and anything over
 * {@link MAX_OAUTH_FORM_BYTES} without buffering it. A request that declares no
 * content type is read as a form, as lenient servers do.
 */
export async function readOAuthForm(request: Request): Promise<OAuthForm> {
  const type = request.headers.get('content-type')?.toLowerCase();
  if (type && !type.startsWith('application/x-www-form-urlencoded')) {
    return { kind: 'wrong-type' };
  }
  return readFormBody(request, MAX_OAUTH_FORM_BYTES);
}

/** The OAuth error response for a form that could not be used (the `ok` case is not a failure). */
export function formFailure(
  form: Exclude<OAuthForm, { readonly kind: 'ok' }>,
): Response {
  switch (form.kind) {
    case 'wrong-type': {
      return oauthError(
        'invalid_request',
        'Send the request as application/x-www-form-urlencoded.',
      );
    }
    case 'too-large': {
      return oauthError('invalid_request', 'The request is too large.');
    }
    case 'unreadable': {
      return oauthError('invalid_request', 'The request body is not readable.');
    }
  }
}
