/**
 * @packageDocumentation
 *
 * Who is calling the MCP endpoint: the bearer token on the request, resolved
 * to a user and the scopes they approved. The token store and user lookup are
 * passed in, so the decision can be tested without a database.
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import { getUserById, type User } from '@/domain/db/users';
import {
  ACCESS_PREFIX,
  authenticateAccessToken,
  bearerToken,
  resourceUri,
  type AccessIdentity,
} from '@/lib/oauth';
import { getDatabase } from '@/domain/db/client';
import { setErrorContext } from '@/lib/core/observability/context';

/** Who the request is from, or why it is not allowed in. */
export type McpAuth =
  /** No `Authorization: Bearer` header at all: start the sign-in flow. */
  | { readonly kind: 'no-token' }
  /** A token was sent but it is unknown, expired, revoked or for another server. */
  | { readonly kind: 'invalid-token' }
  /** A valid token: the user it belongs to and the scopes they approved. */
  | {
      readonly kind: 'ok';
      readonly user: Readonly<User>;
      readonly scope: readonly string[];
    };

/** What authenticating reaches out to. */
export interface McpAuthDeps {
  /** Resolve an access token for `resource` to the grant behind it. */
  readonly identify: (
    token: string,
    resource: string,
    now: number,
  ) => Promise<AccessIdentity | undefined>;
  /** The user with this id, if they still exist. */
  readonly findUser: (id: number) => Promise<User | undefined>;
  /** The time now, in Unix seconds. */
  readonly now: () => number;
}

/**
 * What an access token we issued looks like: our prefix, an underscore, then
 * base64url characters (256 random bits come out at 43; the range tolerates a
 * change of length). Anything else cannot be one of ours, so it is turned away
 * without a database lookup, which keeps a flood of made-up tokens from costing
 * two D1 reads apiece.
 */
const ACCESS_TOKEN_SHAPE = new RegExp(
  `^${ACCESS_PREFIX}_[A-Za-z0-9_-]{20,200}$`,
);

/** The real database, opened only once a token has actually been sent. */
function liveDeps(): McpAuthDeps {
  const db = getDatabase();
  const store = new D1OAuthStore(db);
  return {
    identify: (token, resource, now) =>
      authenticateAccessToken(store, token, resource, now),
    findUser: (id) => getUserById(db, id),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/**
 * Resolve the request's bearer token. `origin` is this site's public origin
 * (a token is only good for the MCP server it was issued for). `deps` is a
 * function so the database is not touched for requests that carry no token, or
 * a token that is not shaped like one we issue.
 */
export async function authenticateMcpRequest(
  request: Request,
  origin: string,
  deps: () => McpAuthDeps = liveDeps,
): Promise<McpAuth> {
  const token = bearerToken(request);
  if (!token) {
    return { kind: 'no-token' };
  }
  if (!ACCESS_TOKEN_SHAPE.test(token)) {
    return { kind: 'invalid-token' };
  }
  const { identify, findUser, now } = deps();
  const identity = await identify(token, resourceUri(origin), now());
  const user = identity ? await findUser(identity.userId) : undefined;
  if (!identity || !user) {
    return { kind: 'invalid-token' };
  }
  // Who and which grant, never the token itself.
  await setErrorContext({
    'user.id': user.id,
    'auth.method': 'mcp',
    'auth.grant_id': identity.grantId,
  });
  return { kind: 'ok', user, scope: identity.scope };
}
