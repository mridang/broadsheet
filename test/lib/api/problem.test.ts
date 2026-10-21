import { describe, expect, it } from '@jest/globals';

import { problem, problems } from '../../../src/lib/api/problem';

describe('problem', () => {
  it('sends RFC 9457 problem details with the right media type and status', async () => {
    const res = problem(
      404,
      '/problems/not-found',
      'Not found',
      'No such recipe.',
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toEqual({
      type: '/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'No such recipe.',
    });
  });

  it('omits detail and errors when there are none', async () => {
    const body = await problem(400, '/problems/x', 'X', undefined, {
      errors: [],
    }).json();
    expect(body).toEqual({ type: '/problems/x', title: 'X', status: 400 });
  });

  it('never caches an error', () => {
    expect(problem(500, '/p', 'P').headers.get('cache-control')).toBe(
      'no-store',
    );
  });
});

describe('problems', () => {
  it('uses the specific status for each kind of failure', () => {
    expect(problems.unauthorized().status).toBe(401);
    expect(problems.forbidden('no').status).toBe(403);
    expect(problems.notFound('recipe').status).toBe(404);
    expect(problems.badRequest('bad').status).toBe(400);
    expect(problems.unsupportedMediaType('application/json').status).toBe(415);
    expect(problems.preconditionFailed().status).toBe(412);
    expect(problems.upstream('drive down').status).toBe(502);
  });

  it('lists per-field errors for a bad request', async () => {
    const body = (await problems
      .badRequest('Invalid.', ['name: required.'])
      .json()) as { errors: string[] };
    expect(body.errors).toEqual(['name: required.']);
  });
});

describe('problems.driveNotConnected', () => {
  it('is a 409 that tells the client to connect Drive', async () => {
    const res = problems.driveNotConnected();
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as { type: string; detail: string };
    expect(body.type).toBe('/problems/drive-not-connected');
    expect(body.detail).toContain('Connect your Google Drive');
  });
});
