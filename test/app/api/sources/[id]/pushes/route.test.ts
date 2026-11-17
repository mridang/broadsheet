import { describe, expect, it } from '@jest/globals';

import { GET, POST as aliasPost } from '@/app/api/sources/[id]/pushes/route';
import { GET as webhookGet, POST } from '@/app/webhooks/sources/[id]/route';

describe('the old WebSub callback /api/sources/{id}/pushes', () => {
  it('is answered by the handlers of /webhooks/sources/{id}', () => {
    expect(GET).toBe(webhookGet);
    expect(aliasPost).toBe(POST);
  });
});
