import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/** The refresh-token grant posted to Google's token endpoint. @public */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string(),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema> &
  ApiModel;
