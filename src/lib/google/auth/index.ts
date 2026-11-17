/**
 * @packageDocumentation
 *
 * Public surface of the Google OAuth client package: the
 * {@link GoogleOAuthClient} and its request/response models.
 */

export { GoogleOAuthClient, SIGN_IN_SCOPES } from './client';
export type { GoogleOAuthCredentials } from './client';
export type {
  ExchangeCodeRequest,
  TokenResponse,
  RefreshTokenRequest,
  AccessTokenResponse,
  GoogleUserResponse,
  RevokeTokenRequest,
  RevokeTokenResponse,
} from './models';
export {
  ExchangeCodeRequestSchema,
  TokenResponseSchema,
  RefreshTokenRequestSchema,
  AccessTokenResponseSchema,
  GoogleUserResponseSchema,
  RevokeTokenRequestSchema,
  RevokeTokenResponseSchema,
} from './models';
