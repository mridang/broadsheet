import { z } from 'zod';

import type { ApiModel } from '@/lib/http';

/**
 * Tokens returned by the authorization-code exchange. `refresh_token` is
 * present only on the first consent (or with `prompt=consent`), and `scope`
 * is the scopes actually granted, which Google lets people narrow on the
 * consent screen. @public
 */
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema> & ApiModel;
