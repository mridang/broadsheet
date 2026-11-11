/**
 * @packageDocumentation
 *
 * The framework-tier auth bindings: resolving the current user, reading and
 * writing the session cookie and the OAuth flow cookies, the sign-out guard,
 * and the GoogleAuthKit that composes a Google sign-in.
 */
export {
  getCurrentUser,
  getLiveSessionUid,
  getSession,
  getSessionUid,
} from './current-user';
export { setSessionCookie } from './session-cookie';
export { finishFlow, type FlowStart, startFlowCookies } from './flow-cookies';
export { type Caller, crossSiteRefusal, requireSignedIn } from './guard';
export { GoogleAuthKit, type GoogleAuthKitConfig } from './google-auth-kit';
