import { describe, expect, it } from '@jest/globals';

import { ApiController } from '@/core/api/controller';
import { problems } from '@/lib/rest-json/problem';

/** Read a response's JSON body as a record. */
async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('ApiController', () => {
  it('answers a handler result as JSON 200 by default', async () => {
    const { GET } = new ApiController()
      .on<null, { hello: string }>({
        method: 'GET',
        handle: () => ({ hello: 'world' }),
      })
      .handlers();
    const res = await GET(new Request('https://app.test/x'));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ hello: 'world' });
  });

  it('honours an encoded status, headers and empty body', async () => {
    const { DELETE } = new ApiController()
      .on<null, boolean>({
        method: 'DELETE',
        handle: () => true,
        encode: () => ({ status: 204, headers: { 'X-Done': 'yes' } }),
      })
      .handlers();
    const res = await DELETE(new Request('https://app.test/x'));
    expect(res.status).toBe(204);
    expect(res.headers.get('x-done')).toBe('yes');
    expect(await res.text()).toBe('');
  });

  it('passes a raw response through the escape hatch', async () => {
    const { GET } = new ApiController()
      .on<null, null>({
        method: 'GET',
        handle: () => null,
        encode: () => ({ response: problems.notFound('thing') }),
      })
      .handlers();
    const res = await GET(new Request('https://app.test/x'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem');
  });

  it('builds the context and gives it to decode and handle', async () => {
    const controller = new ApiController<{ who: string }>({
      context: () => ({ who: 'ada' }),
    }).on<string, { seen: string }>({
      method: 'POST',
      decode: (_request, ctx) => ctx.who.toUpperCase(),
      handle: (input, ctx) => ({ seen: `${input}/${ctx.who}` }),
    });
    const { POST } = controller.handlers();
    expect(await body(await POST(new Request('https://app.test/x')))).toEqual({
      seen: 'ADA/ada',
    });
  });

  it('sends a problem thrown by decode as it is', async () => {
    const { POST } = new ApiController()
      .on<null, null>({
        method: 'POST',
        decode: () => {
          throw problems.badRequest('nope');
        },
        handle: () => null,
      })
      .handlers();
    const res = await POST(new Request('https://app.test/x'));
    expect(res.status).toBe(400);
  });

  it('sends a refusal thrown by the context as it is', async () => {
    const { GET } = new ApiController({
      context: () => {
        throw problems.unauthorized();
      },
    })
      .on<null, null>({ method: 'GET', handle: () => null })
      .handlers();
    expect((await GET(new Request('https://app.test/x'))).status).toBe(401);
  });

  it('maps an unexpected throw to a 500 problem', async () => {
    const { GET } = new ApiController()
      .on<null, null>({
        method: 'GET',
        handle: () => {
          throw new Error('boom');
        },
      })
      .handlers();
    const res = await GET(new Request('https://app.test/x'));
    expect(res.status).toBe(500);
    expect(await body(res)).toMatchObject({ status: 500 });
  });

  it('uses a custom onError when given one', async () => {
    const { GET } = new ApiController({
      onError: () => new Response('handled', { status: 503 }),
    })
      .on<null, null>({
        method: 'GET',
        handle: () => {
          throw new Error('boom');
        },
      })
      .handlers();
    expect((await GET(new Request('https://app.test/x'))).status).toBe(503);
  });
});
