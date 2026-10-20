/**
 * @packageDocumentation
 *
 * How the Worker answers a request, kept out of `src/worker.ts` (which cannot be
 * type-checked, because the app it forwards to is generated at build time) so
 * that it can be checked and tested:
 *
 *  1. the request goes to the app with a fresh Content Security Policy and its
 *     nonce on it (that is where Next.js looks for it);
 *  2. an HTML answer carries that policy, and the report-only Trusted Types one;
 *  3. whatever goes back carries the site's security and cache headers.
 */

import { buildCsp, cspSurfaceFor, forwardedHeaders, newNonce } from './csp';
import { applyResponseHeaders, replacingHeaders } from './headers';

/** The app that answers requests: the generated OpenNext handler. */
export interface ServeApp {
  fetch(
    request: Request,
    env: never,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
}

/** The response with one more header (responses from the app are read-only). */
function withHeader(response: Response, name: string, value: string): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: replacingHeaders(response.headers, { [name]: value }),
  });
}

/** Answer one request. */
export async function serve(
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
  { app }: { readonly app: ServeApp },
): Promise<Response> {
  // Each page gets its own policy, with a one-time number the app puts on its scripts.
  const nonce = newNonce();
  const csp = buildCsp(nonce, cspSurfaceFor(new URL(request.url).pathname));
  const forwarded = new Request(request, {
    headers: forwardedHeaders(request.headers, csp, nonce),
  });
  const fetched = await app.fetch(forwarded, env as never, ctx);
  const isHtml = (fetched.headers.get('content-type') ?? '').startsWith(
    'text/html',
  );
  const response =
    isHtml && !fetched.headers.has('content-security-policy')
      ? withHeader(fetched, 'Content-Security-Policy', csp)
      : fetched;
  return applyResponseHeaders(request, response);
}
