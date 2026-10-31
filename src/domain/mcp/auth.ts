/**
 * @packageDocumentation
 *
 * Who is calling the MCP endpoint: the bearer token on the request, resolved
 * to a person and the scopes they approved. The lookups are passed in, so the
 * decision can be tested without a database.
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import { getUserById } from '@/domain/auth/store';
import {
  ACCESS_PREFIX,
  authenticateAccessToken,
  bearerToken,
  resourceUri,
  type AccessIdentity,
} from '@/lib/oauth';
import { setErrorContext } from '@/lib/core/observability/context';

/** Who the request is from, or why it is not let in. */
export type McpAuth =
  /** No bearer token at all: start the sign-in flow. */
  | { readonly kind: 'no-token' }
  /** A token that is unknown, expired, revoked or for another server. */
  | { readonly kind: 'invalid-token' }
  /** A valid token: whose it is and the scopes they approved. */
  | {
      readonly kind: 'ok';
      readonly uid: number;
      readonly scope: readonly string[];
    };

/** What authenticating reaches out to. */
export interface McpAuthDeps {
  readonly identify: (
    token: string,
    resource: string,
    now: number,
  ) => Promise<AccessIdentity | undefined>;
  /** Whether the account still exists. */
  readonly userExists: (id: number) => Promise<boolean>;
  readonly now: () => number;
}

/**
 * What an access token we issued looks like. Anything else is turned away
 * without a database lookup.
 */
const ACCESS_TOKEN_SHAPE = new RegExp(
  `^${ACCESS_PREFIX}_[A-Za-z0-9_-]{20,200}$`,
);

/** The real database, opened only once a plausible token was sent. */
function liveDeps(): McpAuthDeps {
  const store = new D1OAuthStore(getDatabase());
  return {
    identify: (token, resource, now) =>
      authenticateAccessToken(store, token, resource, now),
    userExists: async (id) => (await getUserById(id)) !== undefined,
    now: () => Math.floor(Date.now() / 1000),
  };
}

/** Resolve the request's bearer token for the MCP server at `origin`. */
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
  const { identify, userExists, now } = deps();
  const identity = await identify(token, resourceUri(origin), now());
  if (!identity || !(await userExists(identity.userId))) {
    return { kind: 'invalid-token' };
  }
  // Who and which grant, never the token itself.
  await setErrorContext({
    'user.id': identity.userId,
    'auth.method': 'mcp',
  });
  return { kind: 'ok', uid: identity.userId, scope: identity.scope };
}
