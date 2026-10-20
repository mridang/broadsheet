/**
 * The security contact file (RFC 9116).
 *
 *   GET /.well-known/security.txt
 */

import { securityTxt } from '@/app/_security-txt';

/**
 * `GET /.well-known/security.txt`: where to report a security problem, as
 * plain text whose expiry date is always ahead of today. Public. Answers 200.
 */
export function GET(): Response {
  return new Response(securityTxt(new Date()), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Re-read daily, so the expiry date keeps moving ahead.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
