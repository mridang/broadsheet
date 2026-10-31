import { describe, expect, it } from '@jest/globals';

import { createPushConfiguration } from '@/domain/api/outbound';

describe('createPushConfiguration', () => {
  it('answers 503 when the server has no VAPID public key', async () => {
    const { GET } = createPushConfiguration(() => ({})).handlers();
    const res = await GET(
      new Request('https://app.test/api/push/configuration'),
    );
    expect(res.status).toBe(503);
  });

  it('answers the public key when one is set', async () => {
    const { GET } = createPushConfiguration(() => ({
      VAPID_PUBLIC_KEY: 'key',
    })).handlers();
    const res = await GET(
      new Request('https://app.test/api/push/configuration'),
    );
    expect(await res.json()).toEqual({ vapid_public_key: 'key' });
  });
});
