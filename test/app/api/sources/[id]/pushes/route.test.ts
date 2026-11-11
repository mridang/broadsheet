import { describe, expect, it } from '@jest/globals';

import {
  GET as aliasGet,
  POST as aliasPost,
} from '@/app/api/sources/[id]/pushes/route';
import {
  GET as webhookGet,
  POST as webhookPost,
} from '@/app/webhooks/sources/[id]/route';

describe('the old WebSub callback /api/sources/{id}/pushes', () => {
  it('is answered by the handlers of /webhooks/sources/{id}', () => {
    expect(aliasGet).toBe(webhookGet);
    expect(aliasPost).toBe(webhookPost);
  });
});
