/**
 * @packageDocumentation
 *
 * Who may use the operator endpoints. The operator proves it with the `CRON_SECRET`
 * as a bearer token. Where no secret is set (local development) the endpoints
 * are open, as the manual triggers always were. The pure rule is in
 * `./operator-rule`; this wraps it with the problem response and logging.
 */

import { isOperator } from './operator-rule';
import { setErrorContext } from '@/lib/core/observability/context';
import { problem } from './problem';
import { logError } from '@/utils/logging';

/** The refusal to send when the caller is not the operator, or undefined when they are. */
export function operatorRefusal(
  request: Request,
  env: Pick<CloudflareEnv, 'CRON_SECRET'>,
): Response | undefined {
  if (isOperator(request.headers.get('authorization'), env.CRON_SECRET)) {
    // Not awaited: this is called from a synchronous guard.
    void setErrorContext({ 'auth.method': 'operator' });
    return undefined;
  }
  logError({
    event: 'operations.unauthorized',
    path: new URL(request.url).pathname,
  });
  return problem(
    401,
    '/problems/unauthorized',
    'Unauthorized',
    'Send the operator token as a Bearer Authorization header.',
    { headers: { 'WWW-Authenticate': 'Bearer' } },
  );
}
