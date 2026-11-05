import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { installFakeTracing } from '../observability/fake-tracing';

const tracing = installFakeTracing();
const { operatorRefusal } = await import('@/lib/core/api/operator-auth');

const request = (authorization?: string) =>
  new Request('https://app.test/api/operations', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });

describe('operatorRefusal', () => {
  beforeEach(() => {
    for (const key of Object.keys(tracing.attributes)) {
      delete tracing.attributes[key];
    }
  });

  it('marks the invocation as the operator once authorised', async () => {
    operatorRefusal(request('Bearer shh'), { CRON_SECRET: 'shh' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(tracing.attributes).toEqual({ 'auth.method': 'operator' });
  });

  it('does not mark a refused caller', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    operatorRefusal(request('Bearer nope'), { CRON_SECRET: 'shh' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(tracing.attributes).toEqual({});
  });

  it('lets anyone in where no secret is set', () => {
    expect(operatorRefusal(request(), {})).toBeUndefined();
    expect(operatorRefusal(request(), { CRON_SECRET: '' })).toBeUndefined();
  });

  it('lets the bearer of the secret in', () => {
    expect(
      operatorRefusal(request('Bearer shh'), { CRON_SECRET: 'shh' }),
    ).toBeUndefined();
  });

  it.each([undefined, 'Bearer nope', 'shh', 'Basic shh'])(
    'answers 401 as a problem, asking for a bearer token, to %j',
    async (authorization) => {
      const res = operatorRefusal(request(authorization), {
        CRON_SECRET: 'shh',
      });
      expect(res?.status).toBe(401);
      expect(res?.headers.get('content-type')).toBe('application/problem+json');
      expect(res?.headers.get('www-authenticate')).toBe('Bearer');
    },
  );
});
