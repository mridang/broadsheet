/**
 * @packageDocumentation
 *
 * The HTTP framework/platform layer: the Worker request pipeline (serve), the
 * edge cache and rate limits, the Content-Security-Policy and its reports, the
 * security/cache response headers, the client address, and the per-app surface
 * these read.
 */
export type { ServeEnv, ServeApp, ServeDeps } from './serve';
export { serverTiming, serve } from './serve';
export { EDGE_LIMITS } from './extras';
export {
  isEdgeCacheable,
  edgeCacheKey,
  storableCopy,
  withFreshNonce,
  edgeCache,
} from './edge-cache';
export type {
  RateLimitBinding,
  Counted,
  RefusalStyle,
  ClassSpec,
  GenericClass,
  EdgeLimitEnv,
  EdgeLimits,
} from './edge-limits';
export {
  GENERIC_CLASSES,
  OVERALL_BINDING,
  genericClass,
  genericLimits,
  counterKey,
  tooManyRequests,
  edgeLimitRefusal,
} from './edge-limits';
export {
  CSP_REPORT_PATH,
  CSP_REPORT_GROUP,
  REPORTING_ENDPOINTS,
  CSP_REPORT_DIRECTIVES,
} from './reporting';
export type { CspSurface } from './csp';
export {
  // eslint-disable-next-line unicorn/no-keyword-prefix -- re-export of the public name from csp.ts
  newNonce,
  buildCsp,
  cspSurfaceFor,
  nonceOf,
  forwardedHeaders,
} from './csp';
export type { ReportSummary } from './csp-reports';
export { MAX_REPORTS_PER_REQUEST, summariseReports } from './csp-reports';
export {
  SECURITY_HEADERS,
  resourcePolicyFor,
  openerPolicyFor,
  replacingHeaders,
  applyResponseHeaders,
} from './headers';
export {
  UNKNOWN_ADDRESS,
  addressSubject,
  clientSubject,
} from './client-address';
export {
  PUBLIC_PAGES,
  EDGE_CACHED_PAGES,
  CACHED_QUERY_PARAMS,
  EDGE_TTL_SECONDS,
  OPEN_FILES,
  RARELY_CHANGING,
  EXTRA_IMG_SOURCES,
  EXTRA_DIRECTIVES,
  STATIC_PREFIXES,
  DISCOVERY_PATHS,
  PAGE_CACHE_RULES,
} from './site';
