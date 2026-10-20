import { describe, expect, it } from '@jest/globals';

import { secretOf } from '../../src/lib/session';

describe('secretOf', () => {
  it('is the SESSION_SECRET secret', () => {
    expect(secretOf({ SESSION_SECRET: 's3cret' } as CloudflareEnv)).toBe(
      's3cret',
    );
  });

  it('is a fixed development value when none is set', () => {
    expect(secretOf({} as CloudflareEnv)).toBe('dev-insecure-secret-change-me');
    expect(secretOf({ SESSION_SECRET: '' } as CloudflareEnv)).toBe(
      'dev-insecure-secret-change-me',
    );
  });
});
