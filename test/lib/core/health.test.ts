import { describe, expect, it } from '@jest/globals';

import { appHealth } from '@/lib/core/health';

describe('appHealth', () => {
  it('has nothing to check beyond the Worker answering', async () => {
    expect(await appHealth()).toEqual({ ok: true, details: {} });
  });
});
