import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/** What the authorization-code exchange posts to Google's token endpoint. @public */
export const ExchangeCodeRequestSchema = z.object({
  code: z.string(),
  redirectUri: z.string(),
});
export type ExchangeCodeRequest = z.infer<typeof ExchangeCodeRequestSchema> &
  ApiModel;
