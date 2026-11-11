/**
 * @packageDocumentation
 *
 * The documents that let an assistant discover how to sign in, and the
 * `WWW-Authenticate` challenge that points it at them:
 *
 * - protected resource metadata (RFC 9728): "this MCP server's authorization
 *    server is over here";
 *  - authorization server metadata (RFC 8414): the endpoints and what they
 *    support.
 *
 * This app is both the resource server and its own authorization server, so
 * both documents describe the same origin.
 */

import { SCOPE_OFFLINE_ACCESS, SUPPORTED_SCOPES } from './scopes';

/** Path of the OAuth-protected MCP endpoint. */
export const MCP_PATH = '/mcp';

/** Well-known path of the protected resource metadata for the MCP endpoint. */
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/** The canonical URI of the MCP server: the `resource` in tokens and requests. */
export function resourceUri(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

/** The path without any trailing slashes. */
function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charAt(end - 1) === '/') end -= 1;
  return path.slice(0, end);
}

/**
 * Whether a client-supplied `resource` names this MCP server. Read as a URL,
 * so case in the scheme and host does not matter; a trailing slash is
 * tolerated, a query or fragment is some other resource.
 */
export function isOurResource(value: string, origin: string): boolean {
  if (!URL.canParse(value)) return false;
  const given = new URL(value);
  const ours = new URL(resourceUri(origin));
  return (
    !given.search &&
    !given.hash &&
    given.origin === ours.origin &&
    withoutTrailingSlashes(given.pathname) === ours.pathname
  );
}

/**
 * Whether a path after `/.well-known/oauth-protected-resource` names the MCP
 * endpoint: nothing, or the endpoint's own path (RFC 9728 §3.3).
 */
export function isProtectedResourcePath(
  segments: readonly string[] | undefined,
): boolean {
  const path = (segments ?? []).join('/');
  return path === '' || `/${path}` === MCP_PATH;
}

/** RFC 9728 document for the MCP endpoint. */
export function protectedResourceMetadata(
  origin: string,
  name: string,
): Record<string, unknown> {
  return {
    resource: resourceUri(origin),
    authorization_servers: [origin],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: name,
  };
}

/** RFC 8414 document for the authorization server. */
export function authorizationServerMetadata(
  origin: string,
): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SUPPORTED_SCOPES, SCOPE_OFFLINE_ACCESS],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * The `WWW-Authenticate` value for a 401/403 from the MCP endpoint: where the
 * metadata is, and the scopes needed.
 */
export function wwwAuthenticate(
  origin: string,
  options: Readonly<{ error?: string; scope?: string }> = {},
): string {
  const parts = [
    ...(options.error ? [`error="${options.error}"`] : []),
    `resource_metadata="${origin}${RESOURCE_METADATA_PATH}"`,
    `scope="${options.scope ?? SUPPORTED_SCOPES.join(' ')}"`,
  ];
  return `Bearer ${parts.join(', ')}`;
}
