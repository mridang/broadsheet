import { describe, expect, it } from '@jest/globals';

import {
  EXTRA_PURPOSES,
  LANDING_PATH,
  RETURN_COOKIE,
  SESSION_COOKIE,
  SIGN_IN_FAILED_PATH,
  STATE_COOKIE,
  sessionClaims,
} from '@/domain/auth/app';
import type { User } from '@/domain/repository';

describe('the app’s sign-in settings', () => {
  it('names its three cookies after the app, so another app on the same domain never reads them', () => {
    expect(SESSION_COOKIE).toBe('broadsheet_session');
    expect(STATE_COOKIE).toBe('broadsheet_oauth_state');
    expect(RETURN_COOKIE).toBe('broadsheet_return_to');
  });

  it('lands on the feed manager after signing in, and on the sign-in page with a fixed flag when it fails', () => {
    expect(LANDING_PATH).toBe('/feeds');
    expect(SIGN_IN_FAILED_PATH).toBe('/login?error=auth');
  });

  it('has no ask besides signing in', () => {
    expect(EXTRA_PURPOSES).toEqual([]);
  });

  it('puts nothing but who the person is in the session cookie', () => {
    expect(sessionClaims({ id: 1 } as User)).toEqual({});
  });
});
