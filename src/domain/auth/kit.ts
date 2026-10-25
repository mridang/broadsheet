/**
 * @packageDocumentation
 *
 * This app's Google sign-in, wired. It binds the framework kit
 * ({@link GoogleAuthKit}) to the app's own settings (`app.ts`), user store
 * (`store.ts`), after-sign-in hook and other asks (`hooks.ts`), and the
 * sign-in completion (`sign-in.ts`). The login and callback routes mount its
 * handlers; nothing else needs to know how the pieces fit together.
 */

import { GoogleAuthKit } from '@/core/auth';
import { SIGN_IN_SCOPES } from '@/lib/google/auth';
import { SIGN_IN_PURPOSE } from '@/lib/web-security';
import {
  EXTRA_PURPOSES,
  RETURN_COOKIE,
  SIGN_IN_FAILED_PATH,
  STATE_COOKIE,
} from '@/domain/auth/app';
import { OTHER_FLOWS } from '@/domain/auth/hooks';
import { completeSignIn, missingSignInSettings } from '@/domain/auth/sign-in';

/** The app's Google sign-in kit. */
export const authKit = new GoogleAuthKit({
  scopes: SIGN_IN_SCOPES,
  stateCookie: STATE_COOKIE,
  returnCookie: RETURN_COOKIE,
  signInFailedPath: SIGN_IN_FAILED_PATH,
  signInPurpose: SIGN_IN_PURPOSE,
  purposes: [SIGN_IN_PURPOSE, ...EXTRA_PURPOSES],
  otherFlows: OTHER_FLOWS,
  completeSignIn,
  missingSignInSettings,
});
