import { describe, expect, it } from '@jest/globals';

import {
  EXPIRED_ROW_GRACE_SECONDS,
  IDLE_GRANT_SECONDS,
  PURGE_PROBABILITY,
  REFRESH_TTL_SECONDS,
  REVOKED_GRANT_KEEP_SECONDS,
  UNUSED_CIMD_CLIENT_KEEP_SECONDS,
  UNUSED_DCR_CLIENT_KEEP_SECONDS,
  purgeCutoffs,
  shouldPurge,
} from '@/lib/oauth';

const NOW = Date.parse('2026-06-01T00:00:00.000Z') / 1000;
const DAY = 86_400;

describe('purgeCutoffs', () => {
  it('keeps expired codes and tokens a day, so a replayed code is still recognised', () => {
    const cutoffs = purgeCutoffs(NOW);
    expect(cutoffs.codesExpiredBefore).toBe(NOW - DAY);
    expect(cutoffs.tokensExpiredBefore).toBe(NOW - DAY);
    expect(EXPIRED_ROW_GRACE_SECONDS).toBe(DAY);
  });

  it('writes the text cutoffs as ISO timestamps that sort like the stored ones', () => {
    const cutoffs = purgeCutoffs(NOW);
    expect(cutoffs.revokedTokensBefore).toBe('2026-05-31T00:00:00.000Z');
    expect(cutoffs.revokedGrantsBefore).toBe('2026-03-03T00:00:00.000Z');
    expect(cutoffs.idleGrantsBefore).toBe('2025-12-03T00:00:00.000Z');
    expect(cutoffs.unusedDcrClientsBefore).toBe('2026-05-02T00:00:00.000Z');
    expect(cutoffs.unusedCimdClientsBefore).toBe('2026-05-02T00:00:00.000Z');
  });

  it('keeps revoked grants longest, so a disconnected app can reconnect', () => {
    expect(REVOKED_GRANT_KEEP_SECONDS).toBeGreaterThan(
      UNUSED_CIMD_CLIENT_KEEP_SECONDS,
    );
    expect(UNUSED_CIMD_CLIENT_KEEP_SECONDS).toBeGreaterThanOrEqual(
      UNUSED_DCR_CLIENT_KEEP_SECONDS,
    );
  });

  it('gives a client that registered but was never approved thirty days, so a half-finished connection can be picked up weeks later', () => {
    expect(UNUSED_DCR_CLIENT_KEEP_SECONDS).toBe(30 * DAY);
  });

  it('ends a connection nobody has used for half a year, well after its refresh tokens ran out', () => {
    expect(IDLE_GRANT_SECONDS).toBe(180 * DAY);
    expect(IDLE_GRANT_SECONDS).toBeGreaterThan(REFRESH_TTL_SECONDS);
  });

  it('moves with the clock', () => {
    expect(purgeCutoffs(NOW + DAY).codesExpiredBefore).toBe(NOW);
  });
});

describe('shouldPurge', () => {
  it('fires for about one request in a hundred', () => {
    expect(PURGE_PROBABILITY).toBeCloseTo(0.01, 10);
    expect(shouldPurge(0)).toBe(true);
    expect(shouldPurge(0.0099)).toBe(true);
    expect(shouldPurge(0.01)).toBe(false);
    expect(shouldPurge(0.5)).toBe(false);
  });

  it('draws its own luck by default', () => {
    expect(typeof shouldPurge()).toBe('boolean');
  });
});
