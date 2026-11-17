/**
 * @packageDocumentation
 *
 * The Google OAuth request/response models: one Zod schema and its inferred
 * type per file. The schemas carry any per-field quirks so the client stays a
 * thin map of endpoint to typed result.
 */

export type { ExchangeCodeRequest } from './exchange-code-request';
export { ExchangeCodeRequestSchema } from './exchange-code-request';
export type { TokenResponse } from './token-response';
export { TokenResponseSchema } from './token-response';
export type { RefreshTokenRequest } from './refresh-token-request';
export { RefreshTokenRequestSchema } from './refresh-token-request';
export type { AccessTokenResponse } from './access-token-response';
export { AccessTokenResponseSchema } from './access-token-response';
export type { GoogleUserResponse } from './google-user-response';
export { GoogleUserResponseSchema } from './google-user-response';
export type { RevokeTokenRequest } from './revoke-token-request';
export { RevokeTokenRequestSchema } from './revoke-token-request';
export type { RevokeTokenResponse } from './revoke-token-response';
export { RevokeTokenResponseSchema } from './revoke-token-response';
