/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414): the endpoints an
 * assistant uses to register, ask for access and get tokens.
 */

import {
  authorizationServerMetadata,
  noStoreJson,
  preflight,
} from '@/lib/oauth';
import { appOrigin } from '@/lib/core/origin';

/**
 * `GET /.well-known/oauth-authorization-server`: the discovery document for
 * this site's authorization server. Public, never cached. Answers 200.
 */
export function GET(request: Request) {
  return noStoreJson(authorizationServerMetadata(appOrigin(request)));
}

/** `OPTIONS /.well-known/oauth-authorization-server`: the CORS preflight. Answers 204. */
export function OPTIONS() {
  return preflight();
}
