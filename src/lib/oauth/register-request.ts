/**
 * @packageDocumentation
 *
 * Answering a dynamic client registration request (`POST /oauth/register`,
 * RFC 7591), free of HTTP: the route reads the body and the caller's address
 * and writes the answer; the order of the checks lives here, where a fake
 * rate-limit store and a fake registry can test it.
 */

import {
  parseRegistrationText,
  registrationResponse,
  type OAuthClient,
} from '@/lib/oauth/client';
import { OAUTH_LIMITS, retryAfterIfLimited } from '@/lib/oauth/limits';
import type { TextBody } from '@/lib/core/api';
import type { RateLimitStore } from '@/lib/rate-limit';

/** What a registration request came to. */
export type RegistrationResult =
  /** The client was registered; `body` is the RFC 7591 answer to send with a 201. */
  | {
      readonly ok: true;
      readonly body: Readonly<Record<string, unknown>>;
    }
  /** The caller has registered too many clients lately. */
  | { readonly ok: false; readonly limited: true; readonly retryAfter: number }
  /** The request was not an acceptable client. */
  | {
      readonly ok: false;
      readonly limited: false;
      readonly error: string;
      readonly description: string;
    };

/** What registering needs from outside. */
export interface RegistrationDeps {
  /** Where the per-address registration counter lives. */
  readonly rateLimits: RateLimitStore;
  /** Store a new client in the registry. */
  readonly save: (client: Readonly<OAuthClient>) => Promise<void>;
  /** The time in Unix seconds. */
  readonly now: number;
}

/**
 * Register a client from the text of a request body. `address` is who is asking
 * (see `clientAddress`). Every attempt counts against the limit, valid or not,
 * so a flood of garbage is throttled as well as a flood of clients; the body is
 * only read once the caller is within the limit, and `readBody` is expected to
 * stop reading at a size cap (see `readBodyText`).
 */
export async function handleRegistration(
  readBody: () => Promise<TextBody>,
  address: string,
  deps: Readonly<RegistrationDeps>,
): Promise<RegistrationResult> {
  const wait = await retryAfterIfLimited(
    deps.rateLimits,
    OAUTH_LIMITS.register,
    address,
    deps.now,
  );
  if (wait !== undefined) {
    return { ok: false, limited: true, retryAfter: wait };
  }
  const body = await readBody();
  const parsed =
    body.kind === 'ok'
      ? parseRegistrationText(body.text)
      : {
          ok: false as const,
          error: 'invalid_client_metadata' as const,
          description:
            body.kind === 'too-large'
              ? 'The request is too large.'
              : 'The request is not valid JSON.',
        };
  if (!parsed.ok) {
    return {
      ok: false,
      limited: false,
      error: parsed.error,
      description: parsed.description,
    };
  }
  await deps.save(parsed.client);
  return { ok: true, body: registrationResponse(parsed.client, deps.now) };
}
