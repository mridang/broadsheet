/**
 * @packageDocumentation
 *
 * The Google OAuth request/response models: one Zod schema and its inferred
 * type per file. The schemas carry any per-field quirks so the client stays a
 * thin map of endpoint to typed result.
 */

export {
  type ExchangeCodeRequest,
  ExchangeCodeRequestSchema,
} from './exchange-code-request';
export { type TokenResponse, TokenResponseSchema } from './token-response';
export {
  type RefreshTokenRequest,
  RefreshTokenRequestSchema,
} from './refresh-token-request';
export {
  type AccessTokenResponse,
  AccessTokenResponseSchema,
} from './access-token-response';
export {
  type GoogleUserResponse,
  GoogleUserResponseSchema,
} from './google-user-response';
export {
  type RevokeTokenRequest,
  RevokeTokenRequestSchema,
} from './revoke-token-request';
export {
  type RevokeTokenResponse,
  RevokeTokenResponseSchema,
} from './revoke-token-response';
