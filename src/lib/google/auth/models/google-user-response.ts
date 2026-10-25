import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/**
 * Who the person is, from the OpenID userinfo endpoint. Only `sub` is always
 * there: a grant that carries just `openid` answers with nothing else. @public
 */
export const GoogleUserResponseSchema = z.object({
  sub: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});
export type GoogleUserResponse = z.infer<typeof GoogleUserResponseSchema> &
  ApiModel;
