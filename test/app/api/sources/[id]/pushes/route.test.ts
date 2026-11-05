import { describe, expect, it } from '@jest/globals';

import * as alias from '@/app/api/sources/[id]/pushes/route';
import * as webhook from '@/app/webhooks/sources/[id]/route';

describe('the old WebSub callback /api/sources/{id}/pushes', () => {
  it('is answered by the handlers of /webhooks/sources/{id}', () => {
    expect(alias.GET).toBe(webhook.GET);
    expect(alias.POST).toBe(webhook.POST);
  });
});
