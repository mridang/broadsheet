import { describe, expect, it } from '@jest/globals';

import { isObject, readJson, readJsonObject } from '@/lib/core/api';

const post = (body: string, type = 'application/json') =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': type },
    body,
  });

/** The status and problem type of a refused body. */
async function refusal(result: { ok: boolean; response?: Response }) {
  expect(result.ok).toBe(false);
  const response = result.response as Response;
  const body: { detail?: string } = await response.json();
  return { status: response.status, body };
}

describe('readJson', () => {
  it('parses a JSON body', async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('ignores media type parameters and case', async () => {
    expect(
      (await readJson(post('[]', 'Application/JSON; charset=utf-8'))).ok,
    ).toBe(true);
  });

  it('refuses another media type with 415', async () => {
    const { status } = await refusal(await readJson(post('{}', 'text/plain')));
    expect(status).toBe(415);
  });

  it('accepts the extra media types a route names', async () => {
    const request = post('{}', 'application/merge-patch+json');
    expect((await readJson(request, ['application/merge-patch+json'])).ok).toBe(
      true,
    );
  });

  it('refuses a body that is not JSON with 400', async () => {
    const { status } = await refusal(await readJson(post('{nope')));
    expect(status).toBe(400);
  });

  it('refuses a string body sent without a content type (it goes out as text/plain)', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      body: '{}',
    });
    expect((await readJson(request)).ok).toBe(false);
  });
});

describe('readJson size limit', () => {
  /** A POST whose body arrives in the given pieces, with no Content-Length. */
  function chunked(pieces: readonly string[]): Request {
    const encoder = new TextEncoder();
    return new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          pieces.forEach((piece) => controller.enqueue(encoder.encode(piece)));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
  }

  /** JSON text of exactly `bytes` bytes. */
  const jsonOf = (bytes: number) => `"${'x'.repeat(bytes - 2)}"`;

  it('accepts a body of exactly 256 KiB by default and refuses one byte more with 413', async () => {
    expect((await readJson(post(jsonOf(256 * 1024)))).ok).toBe(true);
    const { status, body } = await refusal(
      await readJson(post(jsonOf(256 * 1024 + 1))),
    );
    expect(status).toBe(413);
    expect(body.detail).toBe('The request body must be at most 256 KiB.');
  });

  it('answers 413 as a problem document', async () => {
    const result = await readJson(post(jsonOf(300_000)));
    const response = (result as { response: Response }).response;
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    expect(await response.json()).toMatchObject({
      type: '/problems/payload-too-large',
      status: 413,
    });
  });

  it('cuts off a chunked body with no declared length once it passes the limit', async () => {
    const piece = 'x'.repeat(100_000);
    const { status } = await refusal(
      await readJson(chunked(['"', piece, piece, piece, '"'])),
    );
    expect(status).toBe(413);
  });

  it('takes a larger limit from the route', async () => {
    const body = jsonOf(500_000);
    expect((await readJson(post(body), [], 1024 * 1024)).ok).toBe(true);
    const { status, body: problem } = await refusal(
      await readJson(post(body), [], 100 * 1024),
    );
    expect(status).toBe(413);
    expect(problem.detail).toBe('The request body must be at most 100 KiB.');
  });

  it('checks the media type before the size', async () => {
    const { status } = await refusal(
      await readJson(post(jsonOf(300_000), 'text/plain')),
    );
    expect(status).toBe(415);
  });

  it('refuses bytes that are not UTF-8 and an empty body with 400', async () => {
    const bad = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array([0x22, 0xff, 0x22]),
    });
    expect((await refusal(await readJson(bad))).status).toBe(400);
    expect((await refusal(await readJson(post('')))).status).toBe(400);
  });
});

describe('readJsonObject', () => {
  it('passes the limit on', async () => {
    const big = `{"a":"${'x'.repeat(2000)}"}`;
    const { status } = await refusal(
      await readJsonObject(post(big), 'Not an object.', [], 1024),
    );
    expect(status).toBe(413);
  });

  it('passes an object through', async () => {
    expect(await readJsonObject(post('{"a":1}'), 'Not an object.')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("answers 400 with the route's own sentence for other JSON", async () => {
    for (const body of ['[1]', '"x"', '3', 'null']) {
      const { status, body: problem } = await refusal(
        await readJsonObject(post(body), 'The patch must be a JSON object.'),
      );
      expect(status).toBe(400);
      expect(problem.detail).toBe('The patch must be a JSON object.');
    }
  });

  it('passes on the media-type refusal', async () => {
    const { status } = await refusal(
      await readJsonObject(post('{}', 'text/plain'), 'Not an object.'),
    );
    expect(status).toBe(415);
  });
});

describe('isObject', () => {
  it('is true only for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('x')).toBe(false);
  });
});
