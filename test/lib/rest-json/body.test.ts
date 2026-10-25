import { describe, expect, it } from '@jest/globals';

import { readBodyText, readFormBody, readJsonBody } from '@/lib/rest-json';

/** A POST with a body that arrives in the given pieces (no Content-Length, as with chunked uploads). */
function chunked(
  pieces: readonly (string | Uint8Array)[],
  headers: Record<string, string> = {},
): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(
          typeof piece === 'string' ? encoder.encode(piece) : piece,
        );
      }
      controller.close();
    },
  });
  return new Request('https://app.test/x', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('readBodyText', () => {
  it('reads a body under the limit', async () => {
    expect(await readBodyText(chunked(['héllo ', 'wörld']), 100)).toEqual({
      kind: 'ok',
      text: 'héllo wörld',
    });
  });

  it('reads a character that is split between two pieces', async () => {
    const bytes = new TextEncoder().encode('é');
    expect(
      await readBodyText(chunked([bytes.slice(0, 1), bytes.slice(1)]), 100),
    ).toEqual({ kind: 'ok', text: 'é' });
  });

  it('reads a request with no body as empty text', async () => {
    expect(
      await readBodyText(
        new Request('https://app.test/x', { method: 'POST' }),
        10,
      ),
    ).toEqual({ kind: 'ok', text: '' });
  });

  it('refuses a body that announces itself as too large without reading it', async () => {
    let pulled = false;
    // A zero buffer means nothing is pulled unless someone reads.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request('https://app.test/x', {
      method: 'POST',
      headers: { 'content-length': '5000' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await readBodyText(request, 100)).toEqual({ kind: 'too-large' });
    expect(pulled).toBe(false);
  });

  it('cuts off a chunked body as soon as it passes the limit and cancels the upload', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://app.test/x', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await readBodyText(request, 100)).toEqual({ kind: 'too-large' });
    expect(cancelled).toBe(true);
  });

  it('accepts a body of exactly the limit and refuses one byte more', async () => {
    expect((await readBodyText(chunked(['a'.repeat(10)]), 10)).kind).toBe('ok');
    expect((await readBodyText(chunked(['a'.repeat(11)]), 10)).kind).toBe(
      'too-large',
    );
  });

  it('turns away a caller who dribbles a body in more pieces than anyone needs', async () => {
    const pieces = Array.from({ length: 5000 }, () => 'a');
    expect(await readBodyText(chunked(pieces), 1_000_000)).toEqual({
      kind: 'too-large',
    });
  });

  it('calls invalid UTF-8 unreadable', async () => {
    expect(
      await readBodyText(chunked([new Uint8Array([0xff, 0xfe])]), 100),
    ).toEqual({ kind: 'unreadable' });
  });
});

describe('readJsonBody', () => {
  it('parses JSON', async () => {
    expect(await readJsonBody(chunked(['{"a":', '1}']), 100)).toEqual({
      kind: 'ok',
      value: { a: 1 },
    });
  });

  it('calls text that is not JSON, or not UTF-8, unparseable', async () => {
    expect(await readJsonBody(chunked(['{nope']), 100)).toEqual({
      kind: 'unparseable',
    });
    expect(await readJsonBody(chunked([new Uint8Array([0xff])]), 100)).toEqual({
      kind: 'unparseable',
    });
  });

  it('passes a too-large body through', async () => {
    expect(
      await readJsonBody(chunked(['"' + 'a'.repeat(50) + '"']), 10),
    ).toEqual({ kind: 'too-large' });
  });
});

describe('readFormBody', () => {
  it('parses a URL-encoded form', async () => {
    const result = await readFormBody(
      chunked(['grant_type=refresh_token&token=a%20b']),
      100,
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.form.get('grant_type')).toBe('refresh_token');
      expect(result.form.get('token')).toBe('a b');
    }
  });

  it('refuses a form over the limit', async () => {
    expect(await readFormBody(chunked(['a=' + 'b'.repeat(50)]), 10)).toEqual({
      kind: 'too-large',
    });
  });
});
