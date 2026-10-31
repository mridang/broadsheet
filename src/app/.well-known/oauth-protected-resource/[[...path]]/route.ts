/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint,
 * served at the bare well-known path and at the form with `/mcp` appended,
 * since clients try both. Any other path has no document.
 */

import { RESOURCE_NAME } from '@/domain/mcp/app';
import {
  isProtectedResourcePath,
  noStoreJson,
  preflight,
  protectedResourceMetadata,
} from '@/lib/oauth';
import { appOrigin } from '@/lib/core/origin';

/** The route's optional rest of the path. */
interface Context {
  readonly params: Promise<{ readonly path?: readonly string[] }>;
}

/** `GET /.well-known/oauth-protected-resource[/mcp]`: the document. 200, or 404 for another path. */
export async function GET(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { path } = await params;
  return isProtectedResourcePath(path)
    ? noStoreJson(protectedResourceMetadata(appOrigin(request), RESOURCE_NAME))
    : noStoreJson(
        {
          error: 'not_found',
          error_description: 'No protected resource at this path.',
        },
        404,
      );
}

/** `OPTIONS /.well-known/oauth-protected-resource[/mcp]`: the CORS preflight. 204. */
export function OPTIONS() {
  return preflight();
}
