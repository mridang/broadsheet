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
export { finishFlow, startFlowCookies, type FlowStart } from './flow-cookies';
export { crossSiteRefusal, requireSignedIn, type Caller } from './guard';
export { GoogleAuthKit, type GoogleAuthKitConfig } from './google-auth-kit';
