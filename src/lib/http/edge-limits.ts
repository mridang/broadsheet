/**
 * @packageDocumentation
 *
 * The first line of defence against floods and runaway scripts: Cloudflare's
 * Workers Rate Limiting bindings, checked in the Worker before the app (and so
 * before D1, Google, a model or an outbound fetch) is touched. A binding keeps
 * its counters in the Cloudflare location serving the request, with no database
 * write and no network wait, so refusing a flood costs almost nothing. It is
 * permissive and eventually consistent by design (a burst can slip a few
 * requests past, and each location counts for itself), which is what a cost
 * guard wants; the exact, durable counters that matter (the daily budgets, the
 * OAuth registration limit) stay in D1 in the app.
 *
 * Every request that is not a static file belongs to one class. Each class has
 * its own binding, whose limit and period are declared in `wrangler.jsonc` (a
 * period is 10 or 60 seconds), and says who is counted: the caller's network
 * address, or, for the signed-in API, the person (a hash of their session
 * cookie, so many people behind one office address do not share a budget).
 * Because a cookie can be made up, those classes are also counted per address
 * in one roomy overall bucket.
 *
 * The limiter runs before the edge copy of a page is looked up, so a page that
 * is cached still counts against the caller: being cheap to serve does not make
 * it free to request over and over.
 *
 * The classes every app has (pages, the API, pictures, discovery files and
 * browser reports) are here. An app with more adds its own, and says which
 * request belongs to which, in its `extras.ts`. The limiter fails open: a
 * missing binding (local development, tests) or one that throws lets the
 * request through.
 */

import { clientSubject } from './client-address';
import { CSP_REPORT_PATH } from './reporting';
import { DISCOVERY_PATHS, STATIC_PREFIXES } from './site';
import { errorMessage, logError } from '../util/logging';

/** One Workers Rate Limiting binding: `limit` says whether `key` may go ahead. */
export interface RateLimitBinding {
  limit(options: {
    readonly key: string;
  }): Promise<{ readonly success: boolean }>;
}

/** Who a class counts. */
export type Counted = 'address' | 'person' | 'token';

/** How a refusal is worded, so each kind of client can read it. */
export type RefusalStyle = 'jsonrpc' | 'oauth' | 'problem' | 'text';

/** What the edge knows about a class. */
export interface ClassSpec {
  /** The name of the binding (in `wrangler.jsonc`) that counts it. */
  readonly binding: string;
  /** Who is counted. */
  readonly counted: Counted;
  /** The binding's period in seconds, which is also what a refused caller is told to wait. */
  readonly periodSeconds: 10 | 60;
  /** How a caller over the limit is told. */
  readonly style: RefusalStyle;
}

/** The kinds of request every app counts separately. */
export type GenericClass = 'site' | 'api' | 'cover' | 'discovery' | 'reports';

/**
 * The classes every app has, with their bindings. The limits themselves are in
 * `wrangler.jsonc` (a test keeps the two in step).
 */
export const GENERIC_CLASSES: Readonly<Record<GenericClass, ClassSpec>> = {
  cover: {
    binding: 'RL_COVER',
    counted: 'person',
    periodSeconds: 60,
    style: 'problem',
  },
  api: {
    binding: 'RL_API',
    counted: 'person',
    periodSeconds: 60,
    style: 'problem',
  },
  discovery: {
    binding: 'RL_DISCOVERY',
    counted: 'address',
    periodSeconds: 60,
    style: 'text',
  },
  reports: {
    binding: 'RL_REPORTS',
    counted: 'address',
    periodSeconds: 60,
    style: 'text',
  },
  site: {
    binding: 'RL_SITE',
    counted: 'address',
    periodSeconds: 60,
    style: 'text',
  },
};

/** The overall per-address bucket every request outside the static files also counts against. */
export const OVERALL_BINDING = 'RL_ADDRESS';

/** The bindings the Worker may have; absent ones are skipped. */
export type EdgeLimitEnv = Readonly<Record<string, unknown>>;

/** The classes of an app and the rule that sorts a request into one. */
export interface EdgeLimits {
  /** Every class the app counts, by name. */
  readonly classes: Readonly<Record<string, ClassSpec>>;
  /** The class of a request, or undefined for one that is not counted at all (a static file). */
  classify(request: Request): string | undefined;
  /** The name of the cookie that carries a session, or undefined for an app with no sign-in. */
  readonly sessionCookie: string | undefined;
}

/**
 * Which of the {@link GenericClass}es a path belongs to, or undefined for a
 * static file that is not counted at all.
 */
export function genericClass(pathname: string): GenericClass | undefined {
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return undefined;
  }
  if (pathname === CSP_REPORT_PATH) {
    return 'reports';
  }
  if (pathname === '/img') {
    return 'cover';
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/rpc/')) {
    return DISCOVERY_PATHS.has(pathname) ? 'discovery' : 'api';
  }
  if (pathname.startsWith('/.well-known/') || DISCOVERY_PATHS.has(pathname)) {
    return 'discovery';
  }
  return 'site';
}

/** The limits of an app that has only the {@link GENERIC_CLASSES}. */
export function genericLimits(sessionCookie: string | undefined): EdgeLimits {
  return {
    classes: GENERIC_CLASSES,
    classify: (request) => genericClass(new URL(request.url).pathname),
    sessionCookie,
  };
}

/** A request's `name` cookie, if it has one. */
function cookieValue(headers: Headers, name: string): string | undefined {
  return headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** The first 32 hex characters of the SHA-256 of `text`: a stable key that reveals nothing. */
async function digestKey(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The key a class counts a request under. A person is a hash of the session
 * cookie (falling back to the address when there is none, so a caller with no
 * cookie shares the address's budget), a token is a hash of the bearer token.
 */
export async function counterKey(
  counted: Counted,
  headers: Headers,
  sessionCookie: string | undefined,
): Promise<string> {
  if (counted === 'person') {
    const session =
      sessionCookie === undefined
        ? undefined
        : cookieValue(headers, sessionCookie);
    return session
      ? `p:${await digestKey(session)}`
      : `a:${clientSubject(headers)}`;
  }
  if (counted === 'token') {
    const token = /^Bearer\s+(\S+)$/i.exec(
      headers.get('authorization') ?? '',
    )?.[1];
    return token
      ? `t:${await digestKey(token)}`
      : `a:${clientSubject(headers)}`;
  }
  return `a:${clientSubject(headers)}`;
}

/** Whether `value` is a usable binding. */
function isBinding(value: unknown): value is RateLimitBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'limit' in value &&
    typeof value.limit === 'function'
  );
}

/** Ask a binding whether `key` may go ahead; a missing or failing binding says yes. */
async function allowed(
  env: EdgeLimitEnv,
  binding: string,
  key: string,
): Promise<boolean> {
  const candidate = env[binding];
  if (!isBinding(candidate)) {
    return true;
  }
  try {
    return (await candidate.limit({ key })).success;
  } catch (error) {
    logError({
      event: 'edge-limit.counter-failed',
      binding,
      error: errorMessage(error),
    });
    return true;
  }
}

/** The plain sentence every refusal carries. */
const TOO_MANY = 'Too many requests. Wait a moment and try again.';

/**
 * The 429 for a caller over a class's limit, worded for its kind of client:
 * a JSON-RPC error for MCP, an OAuth error for the token and registration
 * endpoints, a problem document for the API, plain text for pages. Always with
 * `Retry-After`, and open CORS for the machine-readable ones (their callers
 * are not browsers on our own pages, and a browser client must be able to read
 * the refusal to back off).
 */
export function tooManyRequests(
  style: RefusalStyle,
  retryAfterSeconds: number,
): Response {
  const common = {
    'Retry-After': String(retryAfterSeconds),
    'Cache-Control': 'no-store',
  };
  const open = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  switch (style) {
    case 'jsonrpc':
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: TOO_MANY,
            data: { retryAfterSeconds },
          },
        },
        { status: 429, headers: { ...common, ...open } },
      );
    case 'oauth':
      return Response.json(
        { error: 'temporarily_unavailable', error_description: TOO_MANY },
        { status: 429, headers: { ...common, ...open, Pragma: 'no-cache' } },
      );
    case 'problem':
      return new Response(
        JSON.stringify({
          type: '/problems/rate-limited',
          title: 'Too many requests',
          status: 429,
          detail: TOO_MANY,
        }),
        {
          status: 429,
          headers: { ...common, 'Content-Type': 'application/problem+json' },
        },
      );
    case 'text':
      return new Response(`${TOO_MANY}\n`, {
        status: 429,
        headers: { ...common, 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

/**
 * The refusal to send if the request is over a limit, or null if it may go on.
 * A request is counted in its own class and, when the class counts a person or
 * a token (which a caller can make up), in the overall bucket for its address
 * as well.
 */
export async function edgeLimitRefusal(
  request: Request,
  env: EdgeLimitEnv,
  limits: EdgeLimits,
): Promise<Response | null> {
  const found = limits.classify(request);
  if (found === undefined || request.method === 'OPTIONS') {
    return null;
  }
  const spec = limits.classes[found];
  if (spec === undefined) {
    return null;
  }
  if (
    !(await allowed(
      env,
      spec.binding,
      await counterKey(spec.counted, request.headers, limits.sessionCookie),
    ))
  ) {
    return tooManyRequests(spec.style, spec.periodSeconds);
  }
  if (spec.counted !== 'address') {
    const overall = `a:${clientSubject(request.headers)}`;
    if (!(await allowed(env, OVERALL_BINDING, overall))) {
      return tooManyRequests(spec.style, spec.periodSeconds);
    }
  }
  return null;
}
