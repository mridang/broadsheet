/**
 * @packageDocumentation
 *
 * What this app adds to the shared edge code (`edge-limits.ts`, used by
 * `serve.ts`): which request counts against which rate limit, beyond the
 * classes every app has. It is the one place an app says what it is protecting.
 * This app has no more than the classes every app has; a signed-in reader is
 * told apart by the session cookie.
 */

import { SESSION_COOKIE } from '../account';
import { genericLimits, type EdgeLimits } from './edge-limits';

/** What this app counts, and how a request is sorted into it. */
export const EDGE_LIMITS: EdgeLimits = genericLimits(SESSION_COOKIE);
