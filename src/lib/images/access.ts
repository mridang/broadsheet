/**
 * @packageDocumentation
 *
 * Which pictures anyone may ask the proxy for. Stories come from any site on
 * the web, so an open proxy would be a free image relay for everyone. Instead
 * every picture address the pages render carries a signature that only this
 * server can make (an HMAC of the address under the `SESSION_SECRET`), and the
 * proxy fetches nothing without a valid one. The signature does not cover the
 * width, so one signature serves a picture at every width the pages offer.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '../util';

/** Domain separation, so a signature made here is never valid for anything else. */
const CONTEXT = 'image:';

/** The signature of `url` under `secret`, URL-safe. */
function sign(secret: string, url: string): string {
  return createHmac('sha256', secret)
    .update(`${CONTEXT}${url}`)
    .digest('base64url');
}

/**
 * The secret in the running Worker, or undefined outside one (tests, builds) or
 * when none is set: with no secret nothing is signed and nothing is accepted,
 * rather than signing with a value anyone could guess.
 */
function currentSecret(): string | undefined {
  try {
    return getEnv().SESSION_SECRET || undefined;
  } catch {
    return undefined;
  }
}

/** Nobody is turned away before the address is looked at: the signature is the rule. */
export async function authenticate(): Promise<Response | undefined> {
  return undefined;
}

/** The signature the pages put on the address of the picture at `url`. */
export function signatureFor(url: string): string | undefined {
  const secret = currentSecret();
  return secret === undefined ? undefined : sign(secret, url);
}

/** Whether `signature` is the one this server made for `url`. */
export function signatureValid(url: string, signature: string | null): boolean {
  const secret = currentSecret();
  if (secret === undefined || signature === null) {
    return false;
  }
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(secret, url));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A signed address may be fetched. */
export async function mayFetch(): Promise<boolean> {
  return true;
}
