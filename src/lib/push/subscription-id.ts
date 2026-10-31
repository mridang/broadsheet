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
  return /^[0-9a-f]{64}$/.test(id);
}

/** The id for a subscription `endpoint`. */
export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(endpoint),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  for (const endpoint of endpoints) {
    if ((await subscriptionId(endpoint)) === id) {
      return endpoint;
    }
  }
  return undefined;
}
