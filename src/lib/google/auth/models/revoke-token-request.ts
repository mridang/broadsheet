import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/** The token handed back to Google's revocation endpoint. @public */
export const RevokeTokenRequestSchema = z.object({
  token: z.string(),
});
export type RevokeTokenRequest = z.infer<typeof RevokeTokenRequestSchema> &
  ApiModel;
