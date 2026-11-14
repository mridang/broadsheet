/**
 * @packageDocumentation
 *
 * The documents that let an assistant discover how to sign in, and the
 * `WWW-Authenticate` challenge that points it at them:
 *
 *  - protected resource metadata (RFC 9728): "this MCP server's authorization
 *    server is over here";
 *  - authorization server metadata (RFC 8414): the endpoints and what they
 *    support.
 *
 * This app is both the resource server and its own authorization server, so
 * both documents describe the same origin.
 */

import { RESOURCE_NAME } from '@/domain/mcp/app';
import { ASSERTION_ALGORITHMS } from '@/lib/oauth/client';
import { SCOPE_OFFLINE_ACCESS, SUPPORTED_SCOPES } from '@/lib/oauth/scopes';
import { parseUrl } from '@/utils/url';

/** Path of the OAuth-protected MCP endpoint. */
export const MCP_PATH = '/mcp';

/** Well-known path of the protected resource metadata for the MCP endpoint. */
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/** The canonical URI of the MCP server: the `resource` in tokens and requests. */
export function resourceUri(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/** The authorization server's issuer identifier. */
export function issuerOf(origin: string): string {
  return origin;
}

/** A path without its trailing slashes. */
const withoutTrailingSlashes = (path: string): string => {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') {
    end -= 1;
  }
  return path.slice(0, end);
};

/**
 * Whether a client-supplied `resource` names this MCP server. The value is read
 * as a URL, so an upper-case scheme or host (`HTTPS://Host/mcp`) is the same
 * address, as the MCP spec asks implementations to accept; trailing slashes are
 * tolerated, since the spec's own examples vary on them. A query or fragment
 * means it is some other resource (RFC 8707 forbids fragments).
 */
export function isOurResource(value: string, origin: string): boolean {
  const given = parseUrl(value);
  const ours = parseUrl(resourceUri(origin));
  if (given === undefined || ours === undefined) {
    return false;
  }
  return (
    !given.search &&
    !given.hash &&
    given.origin === ours.origin &&
    withoutTrailingSlashes(given.pathname) ===
      withoutTrailingSlashes(ours.pathname)
  );
}

/**
 * Whether a path after `/.well-known/oauth-protected-resource` names the MCP
 * endpoint: nothing (the bare form, which describes the whole site's only
 * resource) or the MCP endpoint's own path. RFC 9728 §3.3 says the document's
 * `resource` must match the URL it was derived from, so any other path has no
 * document. `segments` is the optional catch-all route parameter.
 */
export function isProtectedResourcePath(
  segments: readonly string[] | undefined,
): boolean {
  const path = (segments ?? []).join('/');
  return path === '' || `/${path}` === MCP_PATH;
}

/** The RFC 9728 document for the MCP endpoint. */
export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly string[];
  readonly resource_name: string;
}

/** RFC 9728 document for the MCP endpoint. */
export function protectedResourceMetadata(
  origin: string,
): ProtectedResourceMetadata {
  return {
    resource: resourceUri(origin),
    authorization_servers: [issuerOf(origin)],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: RESOURCE_NAME,
  };
}

/** The RFC 8414 document for the authorization server. */
export interface AuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly registration_endpoint: string;
  readonly revocation_endpoint: string;
  readonly revocation_endpoint_auth_methods_supported: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly response_types_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly token_endpoint_auth_signing_alg_values_supported: readonly string[];
  readonly client_id_metadata_document_supported: boolean;
  readonly authorization_response_iss_parameter_supported: boolean;
}

/** RFC 8414 document for the authorization server. */
export function authorizationServerMetadata(
  origin: string,
): AuthorizationServerMetadata {
  return {
    issuer: issuerOf(origin),
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    // Revocation, like the token endpoint, takes public clients only (RFC 8414
    // would otherwise assume client_secret_basic).
    revocation_endpoint_auth_methods_supported: ['none'],
    // `offline_access` is advertised because every grant gets a refresh token,
    // so a client that asks for one (MCP refresh-token guidance) is telling the
    // truth about what it will receive. It is not in the resource metadata or
    // the WWW-Authenticate challenge, where the spec says it does not belong.
    scopes_supported: [...SUPPORTED_SCOPES, SCOPE_OFFLINE_ACCESS],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // `none` for public clients; `private_key_jwt` for those that sign an
    // assertion (a client's metadata document says which it uses).
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: [...ASSERTION_ALGORITHMS],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * The `WWW-Authenticate` value for a 401/403 from the MCP endpoint. It carries
 * the metadata URL (so a client with no token knows where to start) and the
 * scopes needed.
 */
export function wwwAuthenticate(
  origin: string,
  options: Readonly<{
    error?: string;
    description?: string;
    scope?: string;
  }> = {},
): string {
  const parts = [
    ...(options.error ? [`error="${options.error}"`] : []),
    `resource_metadata="${origin}${RESOURCE_METADATA_PATH}"`,
    ...(options.description
      ? [`error_description="${options.description}"`]
      : []),
    `scope="${options.scope ?? SUPPORTED_SCOPES.join(' ')}"`,
  ];
  return `Bearer ${parts.join(', ')}`;
}
