/**
 * @packageDocumentation
 *
 * Public surface of the lib/oauth package.
 */
export {
  AUTHORIZE_FIELDS,
  type AuthorizeCheck,
  type AuthorizeParams,
  type AuthorizeRequest,
  authorizeParamsFrom,
  grantedScope,
  redirectWith,
  validateAuthorizeRequest,
} from './authorize-request';
export {
  ASSERTION_ALGORITHMS,
  type CachedDocument,
  type ClientAuth,
  type ClientBusy,
  type ClientFetch,
  type ClientParse,
  DEFAULT_DOCUMENT_TTL_SECONDS,
  FETCH_USER_AGENT,
  fetchClientMetadata,
  isClientBusy,
  isDocumentFresh,
  isDocumentUsable,
  isMetadataDocumentUrl,
  MAX_CLIENT_ID_LENGTH,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TTL_SECONDS,
  MAX_REGISTRATION_BYTES,
  MAX_STALE_DOCUMENT_SECONDS,
  MIN_DOCUMENT_TTL_SECONDS,
  type OAuthClient,
  documentTtlSeconds,
  parseClientMetadataDocument,
  parseRegistration,
  parseRegistrationText,
  type Registration,
  readCappedText,
  registrationResponse,
} from './client';
export {
  APP_SCHEME_WARNING,
  type ClientIdentity,
  clientIdentity,
  describeRedirect,
  describeScopes,
  LOOPBACK_WARNING,
  MAX_DISPLAY_NAME_LENGTH,
  NEUTRAL_CLIENT_NAME,
  PRIVATE_WARNING,
  type RedirectDescription,
  sanitiseDisplayName,
} from './display';
export {
  bearerToken,
  CORS_HEADERS,
  type FormFields,
  formFailure,
  MAX_OAUTH_FORM_BYTES,
  noStoreJson,
  type OAuthForm,
  oauthError,
  preflight,
  readOAuthForm,
} from './http';
export {
  clientAddress,
  firstRetryAfter,
  OAUTH_LIMITS,
  retryAfterIfLimited,
  tooManyRequests,
} from './limits';
export {
  authorizationServerMetadata,
  type AuthorizationServerMetadata,
  issuerOf,
  isOurResource,
  isProtectedResourcePath,
  MCP_PATH,
  protectedResourceMetadata,
  type ProtectedResourceMetadata,
  RESOURCE_METADATA_PATH,
  resourceUri,
  wwwAuthenticate,
} from './metadata';
export { isWellFormedChallenge, s256, verifyPkce } from './pkce';
export {
  isAcceptableRedirectUri,
  isLoopbackHost,
  isPrivateHost,
  type RedirectKind,
  redirectKind,
  redirectUriMatches,
} from './redirect-uri';
export {
  handleRegistration,
  type RegistrationDeps,
  type RegistrationResult,
} from './register-request';
export {
  EXPIRED_ROW_GRACE_SECONDS,
  IDLE_GRANT_SECONDS,
  MAX_LIVE_GRANTS_PER_APP,
  PURGE_PROBABILITY,
  type PurgeCutoffs,
  purgeCutoffs,
  REVOKED_GRANT_KEEP_SECONDS,
  shouldPurge,
  UNUSED_CIMD_CLIENT_KEEP_SECONDS,
  UNUSED_DCR_CLIENT_KEEP_SECONDS,
} from './retention';
export {
  hasScope,
  isSupportedScope,
  normaliseScope,
  SCOPE_OFFLINE_ACCESS,
  SCOPE_READ,
  SCOPE_WRITE,
  type Scope,
  type ScopedMessage,
  scopeForMessage,
  scopeForTool,
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
  logSecurityEvent,
  type SecurityEvent,
  type SecurityFields,
} from './security-log';
export { type Sweeps, sweepSometimes } from './sweep';
export {
  ACCESS_TTL_SECONDS,
  authenticateAccessToken,
  CODE_TTL_SECONDS,
  type CodeExchange,
  type CodeRecord,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  type GrantRecord,
  issueAuthorizationCode,
  type AccessIdentity,
  type OAuthFailure,
  type OAuthStore,
  type RefreshExchange,
  REFRESH_GRACE_SECONDS,
  REFRESH_TTL_SECONDS,
  revokeToken,
  type TokenRecord,
  type TokenResponse,
  type TokenRow,
  withinRefreshGrace,
} from './token-endpoint';
export {
  formField,
  handleTokenRequest,
  type TokenRequestContext,
  type TokenRequestResult,
} from './token-request';
