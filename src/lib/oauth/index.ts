/**
 * @packageDocumentation
 *
 * Public surface of the lib/oauth package.
 */
export {
  AUTHORIZE_FIELDS,
  type AuthorizeCheck,
  type AuthorizeParams,
  authorizeParamsFrom,
  type AuthorizeRequest,
  CODE_LIFETIME,
  issueAuthorizationCode,
  validateAuthorizeRequest,
} from './authorize';
export {
  bearerToken,
  CORS_HEADERS,
  formFailure,
  MAX_OAUTH_FORM_BYTES,
  noStoreJson,
  oauthError,
  type OAuthForm,
  preflight,
  readOAuthForm,
} from './http';
export {
  authorizationServerMetadata,
  isOurResource,
  isProtectedResourcePath,
  MCP_PATH,
  protectedResourceMetadata,
  RESOURCE_METADATA_PATH,
  resourceUri,
  wwwAuthenticate,
} from './metadata';
export { isWellFormedChallenge, s256, verifyPkce } from './pkce';
export {
  isAcceptableRedirectUri,
  matchesRegistered,
  redirectWith,
} from './redirect-uri';
export {
  MAX_REGISTRATION_BYTES,
  registerClient,
  type RegistrationResult,
} from './register';
export {
  hasScope,
  normaliseScope,
  SCOPE_OFFLINE_ACCESS,
  SCOPE_READ,
  SCOPE_WRITE,
  SUPPORTED_SCOPES,
} from './scopes';
export {
  ACCESS_PREFIX,
  CODE_PREFIX,
  hashSecret,
  newSecret,
  REFRESH_PREFIX,
  type SecretPrefix,
} from './secrets';
export {
  type OAuthClient,
  type OAuthStore,
  type StoredCode,
  type StoredGrant,
  type StoredToken,
  type TokenKind,
} from './store';
export {
  ACCESS_LIFETIME,
  type AccessIdentity,
  authenticateAccessToken,
  handleTokenRequest,
  REFRESH_LIFETIME,
  revokeToken,
  type TokenResponse,
  type TokenResult,
} from './token';
