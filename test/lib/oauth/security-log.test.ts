import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { logSecurityEvent, type SecurityEvent } from '@/lib/oauth';

describe('logSecurityEvent', () => {
  let info: ReturnType<typeof jest.spyOn>;
  let warn: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    info.mockRestore();
    warn.mockRestore();
  });

  it('writes one JSON line with the event first and then its fields', () => {
    logSecurityEvent('oauth.grant_created', { grantId: 'g', userId: 7 });
    expect(info).toHaveBeenCalledWith(
      '{"event":"oauth.grant_created","grantId":"g","userId":7}',
    );
  });

  it.each<SecurityEvent>([
    'oauth.refresh_reuse_detected',
    'oauth.code_replay_detected',
    'oauth.rate_limited',
    'oauth.invalid_client',
  ])(
    'writes %s as a warning, so an alert can watch the warnings alone',
    (event) => {
      logSecurityEvent(event);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
    },
  );

  it.each<SecurityEvent>([
    'oauth.grant_created',
    'oauth.consent_denied',
    'oauth.grant_revoked',
    'oauth.refresh_grace_retry',
    'oauth.scope_narrowed',
  ])('writes %s as information', (event) => {
    logSecurityEvent(event);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('cannot be fooled by a hostile value: it stays one line of valid JSON', () => {
    logSecurityEvent('oauth.invalid_client', {
      clientId: 'x"}\n{"event":"oauth.grant_created',
    });
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({ event: 'oauth.invalid_client' });
  });
});
