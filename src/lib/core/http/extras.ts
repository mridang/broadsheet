/**
 * @packageDocumentation
 *
 * What this app adds to the shared edge code (`edge-limits.ts`, used by
 * `serve.ts`): which request counts against which rate limit, beyond the
 * classes every app has. It is the one place an app says what it is protecting.
 * A signed-in reader is told apart by the session cookie.
 */

import { SESSION_COOKIE } from '@/domain/auth/app';
import {
  GENERIC_CLASSES,
  genericClass,
  type ClassSpec,
  type EdgeLimits,
} from './edge-limits';

/** The kinds of request this app counts besides the classes every app has. */
type OwnClass = 'auth' | 'ai';

/**
 * Every class this app counts, with its binding: signing in and out are slow
 * human actions, and a question to the model costs a model call.
 */
const CLASSES: Readonly<Record<OwnClass, ClassSpec>> = {
  auth: {
    binding: 'RL_AUTH',
    counted: 'address',
    periodSeconds: 60,
    style: 'text',
  },
  ai: {
    binding: 'RL_AI',
    counted: 'person',
    periodSeconds: 60,
    style: 'problem',
  },
};

/** The requests that ask Workers AI a question. */
const AI_PATHS = [
  /^\/api\/articles\/[^/]+\/answers$/,
  /^\/events\/articles\/[^/]+\/answers$/,
  /^\/api\/conversations\/[^/]+\/messages$/,
  /^\/api\/transcriptions$/,
];

/** The class of a request this app counts specially, or undefined when it is one of the classes every app has. */
function ownClass(request: Request): OwnClass | undefined {
  const { pathname } = new URL(request.url);
  if (request.method === 'POST' && AI_PATHS.some((p) => p.test(pathname))) {
    return 'ai';
  }
  return pathname.startsWith('/auth/') || pathname === '/api/sessions/self'
    ? 'auth'
    : undefined;
}

/** What this app counts, and how a request is sorted into it. */
export const EDGE_LIMITS: EdgeLimits = {
  classes: { ...GENERIC_CLASSES, ...CLASSES },
  classify: (request) =>
    ownClass(request) ?? genericClass(new URL(request.url).pathname),
  sessionCookie: SESSION_COOKIE,
};
