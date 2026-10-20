/**
 * @packageDocumentation
 *
 * The text of `/.well-known/security.txt` (RFC 9116): who to tell about a
 * security problem, where the disclosure policy is, and until when this
 * information can be trusted.
 */

import { BRAND_URL, SECURITY_CONTACT, SECURITY_POLICY_URL } from './_brand';

/**
 * How long the file claims to be valid. RFC 9116 section 2.5.5 recommends
 * "less than a year", and a half year keeps the claim meaningful. The route
 * re-renders it daily, so it keeps moving ahead for as long as the site is
 * deployed: if the site is abandoned, the file goes stale on its own.
 */
export const SECURITY_TXT_VALID_DAYS = 180;

/** The file's text, valid for {@link SECURITY_TXT_VALID_DAYS} days from `now`. */
export function securityTxt(now: Date): string {
  const expires = new Date(
    now.getTime() + SECURITY_TXT_VALID_DAYS * 24 * 60 * 60 * 1000,
  );
  return [
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${BRAND_URL}/.well-known/security.txt`,
    `Policy: ${SECURITY_POLICY_URL}`,
    '',
  ].join('\n');
}
