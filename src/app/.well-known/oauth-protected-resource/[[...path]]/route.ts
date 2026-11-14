/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint. An
 * assistant that gets a 401 from `/mcp` is pointed here to learn which
 * authorization server to use. Served at the bare well-known path and at the
 * path-inserted form for `/mcp`, since clients try both. Any other path
 * has no document (RFC 9728 §3.3: the `resource` must match the path it was
 * derived from).
 */

import {
  isProtectedResourcePath,
  noStoreJson,
  preflight,
  protectedResourceMetadata,
} from '@/lib/oauth';
import { appOrigin } from '@/lib/core/origin';

/** The route's dynamic segments: the optional rest of the path after the well-known prefix. */
interface Context {
  readonly params: Promise<{ readonly path?: readonly string[] }>;
}

/**
 * `GET /.well-known/oauth-protected-resource[/mcp]`: the discovery document
 * for the MCP endpoint, naming this site as its own authorization server.
 * Public, never cached. Answers 200, or 404 for a path that is not the MCP
 * endpoint's.
 */
export async function GET(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { path } = await params;
  return isProtectedResourcePath(path)
    ? noStoreJson(protectedResourceMetadata(appOrigin(request)))
    : noStoreJson(
        {
          error: 'not_found',
          error_description: 'No protected resource at this path.',
        },
        404,
      );
}

/** `OPTIONS /.well-known/oauth-protected-resource[/mcp]`: the CORS preflight. Answers 204. */
export function OPTIONS() {
  return preflight();
}
