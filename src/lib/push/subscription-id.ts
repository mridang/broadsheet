const IS_SUBSCRIPTION_ID_PATTERN = /^[0-9a-f]{64}$/u;
/**
 * @packageDocumentation
 *
 * The id of a push subscription as it appears in `/api/push/subscriptions/{id}`:
 * the lowercase hex SHA-256 of its endpoint. The endpoint itself is a long,
 * secret-ish URL that does not belong in a path, and a browser can always
 * recompute the id from the subscription it holds.
 */

/** Whether `id` has the shape of a {@link subscriptionId}: 64 lowercase hex digits. */
export function isSubscriptionId(id: string): boolean {
  return IS_SUBSCRIPTION_ID_PATTERN.test(id);
}

/** The id for a subscription `endpoint`. */
export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(endpoint),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * The stored endpoint whose {@link subscriptionId} is `id`, if there is one.
 * The id is a hash, so it cannot be looked up directly; the table is small (one
 * row per installed browser).
 */
export async function endpointForId(
  endpoints: readonly string[],
  id: string,
): Promise<string | undefined> {
  // eslint-disable-next-line functional/no-loop-statements -- hashes one endpoint after another and stops at the first match
  for (const endpoint of endpoints) {
    if ((await subscriptionId(endpoint)) === id) {
      return endpoint;
    }
  }
  return undefined;
}
