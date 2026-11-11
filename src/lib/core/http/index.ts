/**
 * @packageDocumentation
 *
 * The HTTP framework/platform layer: the Worker request pipeline (serve), the
 * edge cache and rate limits, the Content-Security-Policy and its reports, the
 * security/cache response headers, the client address, and the per-app surface
 * these read.
 */
export {
  serve,
  type ServeApp,
  type ServeDeps,
  type ServeEnv,
  serverTiming,
} from './serve';
export { EDGE_LIMITS } from './extras';
export {
  edgeCache,
  edgeCacheKey,
  isEdgeCacheable,
  storableCopy,
  withFreshNonce,
} from './edge-cache';
export {
  type ClassSpec,
  type Counted,
  counterKey,
  type EdgeLimitEnv,
  edgeLimitRefusal,
  type EdgeLimits,
  GENERIC_CLASSES,
  genericClass,
  type GenericClass,
  genericLimits,
  OVERALL_BINDING,
  type RateLimitBinding,
  type RefusalStyle,
  tooManyRequests,
} from './edge-limits';
export {
  CSP_REPORT_DIRECTIVES,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  REPORTING_ENDPOINTS,
} from './reporting';
export {
  buildCsp,
  type CspSurface,
  cspSurfaceFor,
  forwardedHeaders,
  newNonce,
  nonceOf,
} from './csp';
export {
  MAX_REPORTS_PER_REQUEST,
  type ReportSummary,
  summariseReports,
} from './csp-reports';
export {
  applyResponseHeaders,
  openerPolicyFor,
  replacingHeaders,
  resourcePolicyFor,
  SECURITY_HEADERS,
} from './headers';
export {
  addressSubject,
  clientSubject,
  UNKNOWN_ADDRESS,
} from './client-address';
export {
  CACHED_QUERY_PARAMS,
  DISCOVERY_PATHS,
  EDGE_CACHED_PAGES,
  EDGE_TTL_SECONDS,
  EXTRA_DIRECTIVES,
  EXTRA_IMG_SOURCES,
  OPEN_FILES,
  PAGE_CACHE_RULES,
  PUBLIC_PAGES,
  RARELY_CHANGING,
  STATIC_PREFIXES,
} from './site';
