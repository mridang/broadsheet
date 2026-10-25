import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/** Google's revocation endpoint answers with an empty body. @public */
export const RevokeTokenResponseSchema = z.object({});
export type RevokeTokenResponse = z.infer<typeof RevokeTokenResponseSchema> &
  ApiModel;
