/**
 * @packageDocumentation
 *
 * A small controller framework for the REST API, built on the pure
 * JSON/problem primitives in this package. A route registers typed endpoints —
 * each with an optional `decode` (request → input), a `handle` (input → output) and an
 * optional `encode` (output → response) — and the controller wires the
 * pipeline: build the per-request context, decode (a thrown problem becomes the
 * 4xx), handle, then encode to a `Response` (JSON 200 by default). A thrown
 * `Response` (a problem) is sent as it is; any other thrown value becomes a
 * 500 problem through `onError`. A method with no endpoint is simply not
 * mounted, so Next answers it 405.
 *
 * This is the one Next-aware seam over the pure JSON/problem primitives in
 * this package: endpoints and their controllers hold no framework code, so
 * they grow without touching the route file, which only mounts `handlers()`.
 */

import { appOrigin } from '@/lib/core/origin';
import { problem } from './problem';
import { encodeCursor, type CursorPosition } from './pagination';
import type { RouteContext } from './route-context';

/** The HTTP methods an endpoint may answer. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * How an endpoint's output becomes a response. An endpoint builds one with the
 * success vocabulary in `./results` (`ok`/`created`/`noContent`/`page`) rather
 * than filling these fields by hand; the controller renders the status, the
 * absolute `Location` and the page body here, in one place.
 */
export interface ApiResponse<Output> {
  /** Status code; 200 by default (204 when there is no body). */
  readonly status?: number;
  /** The JSON body; omit for an empty response. */
  readonly body?: Output;
  /** Extra response headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * A path on this app; the controller makes it an absolute `Location` header
   * against the app's public origin. The status is whatever the result sets
   * (`created` makes it 201), so this header can ride a 200 too.
   */
  readonly location?: string;
  /**
   * One page of a list; the controller builds the `{ self, next?, items }` body
   * and its cursor links from the request, so no handler builds a paging URL.
   */
  readonly page?: {
    readonly items: readonly unknown[];
    readonly next?: CursorPosition;
  };
  /** Escape hatch: send this response verbatim (cookies, redirects, …). */
  readonly response?: Response;
}

/** One endpoint: decode the request, handle it, encode the result. */
export interface Endpoint<Input, Output, Ctx> {
  readonly method: HttpMethod;
  /** Turn the request into typed input; throw a problem `Response` for a 4xx. */
  decode?(request: Request, ctx: Ctx): Promise<Input> | Input;
  /** The business step. */
  handle(input: Input, ctx: Ctx): Promise<Output> | Output;
  /** Turn the output into a response; JSON 200 by default. The wire body may differ from the output. */
  encode?(output: Output, ctx: Ctx): ApiResponse<unknown> | Response;
}

/** Options for a controller: how to build the context, and how to map an unknown error. */
export interface ApiControllerOptions<Ctx> {
  /** Build the per-request context; throw a problem `Response` to refuse. */
  readonly context?: (
    request: Request,
    route: RouteContext,
  ) => Promise<Ctx> | Ctx;
  /** Map an unexpected thrown value to a problem; a 500 by default. */
  readonly onError?: (error: unknown) => Response;
}

/** The handler Next mounts: the request plus its optional route context. */
export type RouteHandler = (
  request: Request,
  route?: RouteContext,
) => Promise<Response>;

/** A 500 problem that leaks nothing about the cause. */
function serverError(): Response {
  return problem(
    500,
    '/problems/internal',
    'Internal server error',
    'Something went wrong.',
  );
}

/** The wire body of a page: the current URL, the next page's URL, and the items. */
interface PageBody {
  readonly self: string;
  readonly next?: string;
  readonly items: readonly unknown[];
}

/**
 * The response body for a `page` result: `self` is the request's own absolute
 * URL (on the app's public origin), and `next` is the same URL with the cursor
 * swapped for the one that starts the following page. Built here so a handler
 * only computes the `next` position, never a URL.
 */
function pageBody(
  request: Request,
  page: NonNullable<ApiResponse<unknown>['page']>,
): PageBody {
  const url = new URL(request.url);
  const origin = appOrigin(request);
  const self = `${origin}${url.pathname}${url.search}`;
  if (!page.next) {
    return { self, items: page.items };
  }
  const query = new URLSearchParams(url.search);
  query.set('cursor', encodeCursor(page.next));
  return {
    self,
    next: `${origin}${url.pathname}?${query.toString()}`,
    items: page.items,
  };
}

/**
 * Build a `Response` from an endpoint's `ApiResponse`. The request is needed to
 * resolve a relative `location` and the paging URLs against the app's origin.
 */
function toResponse(
  result: ApiResponse<unknown> | Response,
  request: Request,
): Response {
  if (result instanceof Response) {
    return result;
  }
  if (result.response) {
    return result.response;
  }
  const headers = new Headers(result.headers);
  if (result.location !== undefined) {
    headers.set('Location', `${appOrigin(request)}${result.location}`);
  }
  const body =
    result.page !== undefined ? pageBody(request, result.page) : result.body;
  const status = result.status ?? (body === undefined ? 204 : 200);
  if (body === undefined) {
    return new Response(null, { status, headers });
  }
  const response = Response.json(body, { status });
  headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}

/**
 * Registers typed endpoints and mounts them as Next route handlers. `Ctx` is
 * the per-request context the `context` option builds (the raw request by
 * default).
 */
export class ApiController<Ctx = Request> {
  readonly #options: ApiControllerOptions<Ctx>;
  readonly #endpoints = new Map<HttpMethod, Endpoint<unknown, unknown, Ctx>>();

  constructor(options: ApiControllerOptions<Ctx> = {}) {
    this.#options = options;
  }

  /** Register an endpoint for its method. */
  on<Input, Output>(endpoint: Endpoint<Input, Output, Ctx>): this {
    this.#endpoints.set(
      endpoint.method,
      endpoint as Endpoint<unknown, unknown, Ctx>,
    );
    return this;
  }

  /** Run one endpoint through the pipeline. */
  async #run(
    endpoint: Endpoint<unknown, unknown, Ctx>,
    request: Request,
    route: RouteContext,
  ): Promise<Response> {
    try {
      const ctx = (
        this.#options.context
          ? await this.#options.context(request, route)
          : request
      ) as Ctx;
      const input = endpoint.decode
        ? await endpoint.decode(request, ctx)
        : null;
      const output = await endpoint.handle(input, ctx);
      const result: ApiResponse<unknown> | Response = endpoint.encode
        ? endpoint.encode(output, ctx)
        : { body: output };
      return toResponse(result, request);
    } catch (error) {
      // A thrown problem response (bad input, a refusal) is the answer.
      if (error instanceof Response) {
        return error;
      }
      return (this.#options.onError ?? serverError)(error);
    }
  }

  /**
   * The Next route handlers, one per registered method. Typed as a full map so
   * a route can `export const { POST } = controller.handlers()`; only the
   * methods actually registered are present.
   */
  handlers(): Record<HttpMethod, RouteHandler> {
    const handlers: Partial<Record<HttpMethod, RouteHandler>> = {};
    for (const [method, endpoint] of this.#endpoints) {
      handlers[method] = (request, route = {}) =>
        this.#run(endpoint, request, route);
    }
    return handlers as Record<HttpMethod, RouteHandler>;
  }
}
