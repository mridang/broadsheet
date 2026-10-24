/**
 * @packageDocumentation
 *
 * Reading JSON request bodies for the REST API: checks the media type (415 if
 * it's wrong), the size (413 if it's over the route's limit, checked while the
 * body streams in, so a huge upload is never held in memory) and the syntax
 * (400 if it isn't JSON), so each route can assume a parsed value and focus on
 * validating its fields.
 */

import { readJsonBody } from '@/lib/rest-json/body';
import { problem, problems } from '@/lib/rest-json/problem';

/**
 * The largest JSON body a route accepts unless it asks for more. Generous for
 * anything the app sends (the largest field, a recipe's Cooklang, is capped at
 * 200,000 characters) and small enough that a hostile upload costs next to
 * nothing.
 */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/** The 413 problem for a body over `maxBytes`. */
function tooLarge(maxBytes: number): Response {
  return problem(
    413,
    '/problems/payload-too-large',
    'Payload too large',
    `The request body must be at most ${Math.round(maxBytes / 1024)} KiB.`,
  );
}

/** A parsed body, or the problem response to send. */
export type Body =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/**
 * Read the request body as JSON. `mediaTypes` lists the acceptable
 * `Content-Type`s; `application/json` is always acceptable. A body over
 * `maxBytes` (256 KiB unless the route says otherwise) is refused with 413.
 */
export async function readJson(
  request: Request,
  mediaTypes: readonly string[] = [],
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Body> {
  const accepted = ['application/json', ...mediaTypes];
  // Only the media type matters; parameters such as `charset` are ignored.
  const [essence = ''] = (request.headers.get('content-type') ?? '').split(';');
  const type = essence.trim().toLowerCase();
  if (!accepted.includes(type)) {
    return {
      ok: false,
      response: problems.unsupportedMediaType(accepted.join(' or ')),
    };
  }
  const body = await readJsonBody(request, maxBytes);
  switch (body.kind) {
    case 'ok':
      return { ok: true, value: body.value };
    case 'too-large':
      return { ok: false, response: tooLarge(maxBytes) };
    case 'unparseable':
      return {
        ok: false,
        response: problems.badRequest('The request body is not valid JSON.'),
      };
  }
}

/** A parsed JSON object, or the problem response to send. */
export type ObjectBody =
  | {
      readonly ok: true;
      readonly value: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly response: Response };

/**
 * Read the request body as a JSON object. `notObject` is the sentence for a
 * body that is JSON but not an object ("The patch must be a JSON object.").
 * `mediaTypes` and `maxBytes` are as for {@link readJson}.
 */
export async function readJsonObject(
  request: Request,
  notObject: string,
  mediaTypes: readonly string[] = [],
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<ObjectBody> {
  const body = await readJson(request, mediaTypes, maxBytes);
  if (!body.ok) {
    return body;
  }
  return isObject(body.value)
    ? { ok: true, value: body.value }
    : { ok: false, response: problems.badRequest(notObject) };
}

/** Whether a parsed body is a plain JSON object. */
export function isObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
