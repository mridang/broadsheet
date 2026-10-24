/**
 * @packageDocumentation
 *
 * A small controller framework for the REST API, built on the pure
 * `lib/rest-json` primitives. A route registers typed endpoints — each with an
 * optional `decode` (request → input), a `handle` (input → output) and an
 * optional `encode` (output → response) — and the controller wires the
 * pipeline: build the per-request context, decode (a thrown problem becomes the
 * 4xx), handle, then encode to a `Response` (JSON 200 by default). A thrown
 * `Response` (a problem) is sent as it is; any other thrown value becomes a
 * 500 problem through `onError`. A method with no endpoint is simply not
 * mounted, so Next answers it 405.
 *
 * This is the one Next-aware seam over `lib/rest-json`: endpoints and their
 * controllers hold no framework code, so they grow without touching the route
 * file, which only mounts `handlers()`.
 */

import { problem } from '@/lib/rest-json/problem';
import type { RouteContext } from '@/core/api/route-context';

/** The HTTP methods an endpoint may answer. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** How an endpoint's output becomes a response. */
export interface ApiResponse<Output> {
  /** Status code; 200 by default (or 204 when there is no body). */
  readonly status?: number;
  /** The JSON body; omit for an empty response. */
  readonly body?: Output;
  /** Extra response headers. */
  readonly headers?: Readonly<Record<string, string>>;
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

/** Build a `Response` from an endpoint's `ApiResponse`. */
function toResponse(result: ApiResponse<unknown> | Response): Response {
  if (result instanceof Response) {
    return result;
  }
  if (result.response) {
    return result.response;
  }
  const status = result.status ?? (result.body === undefined ? 204 : 200);
  const headers = new Headers(result.headers);
  if (result.body === undefined) {
    return new Response(null, { status, headers });
  }
  const response = Response.json(result.body, { status });
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
      return toResponse(result);
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
