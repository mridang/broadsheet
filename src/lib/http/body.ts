/**
 * @packageDocumentation
 *
 * Reading a request body without trusting its size. `request.json()` and
 * `request.formData()` buffer the whole body before anyone can look at it, so a
 * caller who sends a hundred megabytes costs memory and time even if the route
 * would have refused it at once. These readers refuse a body that announces
 * itself as too large without reading a byte, read a chunked or lying body
 * piece by piece, and drop it (cancelling the upload) the moment it passes the
 * limit.
 */

/**
 * The most separate pieces a body may arrive in. Reading keeps a list of the
 * pieces so far, which is cheap for the few hundred a real client sends and
 * wasteful for a caller dribbling a byte at a time, who is turned away instead.
 */
const MAX_BODY_CHUNKS = 4096;

/** What reading a body as text came to. */
export type TextBody =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable' };

/** What reading a body as JSON came to. */
export type JsonBody =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unparseable' };

/** What reading a URL-encoded form body came to. */
export type FormBody =
  | { readonly kind: 'ok'; readonly form: URLSearchParams }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable' };

/** The pieces of a body read so far, or null once there were too many bytes or pieces. */
async function readPieces(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  soFar: readonly Uint8Array[] = [],
  size = 0,
): Promise<readonly Uint8Array[] | null> {
  const { done, value } = await reader.read();
  if (done) {
    return soFar;
  }
  const total = size + value.byteLength;
  if (total > maxBytes || soFar.length >= MAX_BODY_CHUNKS) {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  return readPieces(reader, maxBytes, [...soFar, value], total);
}

/** Whether the request announces a body over the limit before sending any of it. */
function announcedTooLarge(request: Request, maxBytes: number): boolean {
  const length = Number(request.headers.get('content-length'));
  return Number.isFinite(length) && length > maxBytes;
}

/**
 * Read the request body as UTF-8 text, refusing anything over `maxBytes`.
 * Invalid UTF-8 is `unreadable`; a request with no body reads as empty text.
 */
export async function readBodyText(
  request: Request,
  maxBytes: number,
): Promise<TextBody> {
  if (announcedTooLarge(request, maxBytes)) {
    return { kind: 'too-large' };
  }
  const pieces = request.body
    ? await readPieces(request.body.getReader(), maxBytes)
    : [];
  if (pieces === null) {
    return { kind: 'too-large' };
  }
  try {
    // One decoder reads the pieces in order (a character may be split between
    // two of them); `fatal` makes invalid UTF-8 an error.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text =
      pieces.map((piece) => decoder.decode(piece, { stream: true })).join('') +
      decoder.decode();
    return { kind: 'ok', text };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** Read the request body as JSON, refusing anything over `maxBytes`. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBody> {
  const body = await readBodyText(request, maxBytes);
  if (body.kind !== 'ok') {
    return body.kind === 'too-large' ? body : { kind: 'unparseable' };
  }
  try {
    return { kind: 'ok', value: JSON.parse(body.text) };
  } catch {
    return { kind: 'unparseable' };
  }
}

/**
 * Read a URL-encoded form body (`application/x-www-form-urlencoded`, which is
 * what a browser sends for a plain `<form>` and what OAuth clients send to the
 * token endpoint), refusing anything over `maxBytes`.
 */
export async function readFormBody(
  request: Request,
  maxBytes: number,
): Promise<FormBody> {
  const body = await readBodyText(request, maxBytes);
  return body.kind === 'ok'
    ? { kind: 'ok', form: new URLSearchParams(body.text) }
    : body;
}
