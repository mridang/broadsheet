import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/** A short-lived access token minted from a refresh token. @public */
export const AccessTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});
export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema> &
  ApiModel;
