/**
 * @packageDocumentation
 *
 * Security events of the OAuth server, written as one structured line each so a
 * log search can answer "who approved what, and when did a token get reused".
 * An event names what happened and carries identifiers (grant, client, user)
 * and numbers; it never carries a token, a code, a verifier, an e-mail address
 * or any other secret. Suspicious events go out as warnings, ordinary ones as
 * information, so an alert can watch the warnings alone.
 */

/** The things worth a log line, as `oauth.<what>`. */
export type SecurityEvent =
  /** A person approved an app (a grant now exists). */
  | 'oauth.grant_created'
  /** A person cancelled at the approval screen. */
  | 'oauth.consent_denied'
  /** An app was disconnected, by the person or because a token was replayed. */
  | 'oauth.grant_revoked'
  /** A spent refresh token came back too late: the grant was ended as probably stolen. */
  | 'oauth.refresh_reuse_detected'
  /** A spent refresh token was presented again inside the grace window and answered. */
  | 'oauth.refresh_grace_retry'
  /** A used authorization code was presented again: what it made was revoked. */
  | 'oauth.code_replay_detected'
  /** An OAuth endpoint answered 429. */
  | 'oauth.rate_limited'
  /** A request named a client we do not know. */
  | 'oauth.invalid_client'
  /** The person granted less than the app asked for. */
  | 'oauth.scope_narrowed';

/** The members an event may carry: identifiers and counts, never secrets. */
export type SecurityFields = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/** Events that mean someone may be attacking, as opposed to ordinary activity. */
const WARNINGS: ReadonlySet<SecurityEvent> = new Set<SecurityEvent>([
  'oauth.refresh_reuse_detected',
  'oauth.code_replay_detected',
  'oauth.rate_limited',
  'oauth.invalid_client',
]);

/** Write one security event as a JSON line (`event` first, then its fields). */
export function logSecurityEvent(
  event: SecurityEvent,
  fields: SecurityFields = {},
): void {
  const line = JSON.stringify({ event, ...fields });
  if (WARNINGS.has(event)) {
    console.warn(line);
  } else {
    console.info(line);
  }
}
