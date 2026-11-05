/**
 * @packageDocumentation
 *
 * The rule for who may use the operator API, with no framework knowledge: the
 * caller proves it with a shared secret as a bearer token. Where no secret is
 * set (local development) the endpoints are open. The wrapper that turns a
 * refusal into an HTTP response is `operator-auth.ts`.
 */

/**
 * Whether a request's `Authorization` header authorises the operator. With no
 * `secret` configured everyone is authorised (local development); otherwise the
 * header must be exactly `Bearer <secret>`.
 */
export function isOperator(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) {
    return true;
  }
  return authorization === `Bearer ${secret}`;
}
