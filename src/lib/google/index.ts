/**
 * @packageDocumentation
 *
 * Public surface of the lib/google vendor group: the Google OAuth client package.
 */
export { GoogleOAuthClient, SIGN_IN_SCOPES } from './auth';
export type { GoogleOAuthCredentials } from './auth';
export type {
  ExchangeCodeRequest,
  TokenResponse,
  RefreshTokenRequest,
  AccessTokenResponse,
  GoogleUserResponse,
  RevokeTokenRequest,
  RevokeTokenResponse,
} from './auth';
export {
  ExchangeCodeRequestSchema,
  TokenResponseSchema,
  RefreshTokenRequestSchema,
  AccessTokenResponseSchema,
  GoogleUserResponseSchema,
  RevokeTokenRequestSchema,
  RevokeTokenResponseSchema,
} from './auth';
