/**
 * @packageDocumentation
 *
 * Public surface of the Google OAuth client package: the
 * {@link GoogleOAuthClient} and its request/response models.
 */

export { GoogleOAuthClient, SIGN_IN_SCOPES } from './client';
export type { GoogleOAuthCredentials } from './client';
export {
  type AccessTokenResponse,
  AccessTokenResponseSchema,
  type ExchangeCodeRequest,
  ExchangeCodeRequestSchema,
  type GoogleUserResponse,
  GoogleUserResponseSchema,
  type RefreshTokenRequest,
  RefreshTokenRequestSchema,
  type RevokeTokenRequest,
  RevokeTokenRequestSchema,
  type RevokeTokenResponse,
  RevokeTokenResponseSchema,
  type TokenResponse,
  TokenResponseSchema,
} from './models';
