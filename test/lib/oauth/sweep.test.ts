import { describe, expect, it, jest } from '@jest/globals';

import { sweepSometimes } from '@/lib/oauth';

const sweeps = () => ({
  purgeOAuth: jest.fn(async () => undefined),
  purgeRateLimits: jest.fn(async () => undefined),
});

describe('sweepSometimes', () => {
  it('does nothing for most requests', () => {
    const s = sweeps();
    const run = jest.fn();
    expect(sweepSometimes(s, run, 0.5)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(s.purgeOAuth).not.toHaveBeenCalled();
  });

  it('starts both clean-ups in the background for the lucky one', async () => {
    const s = sweeps();
    const run = jest.fn();
    expect(sweepSometimes(s, run, 0)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await run.mock.calls[0]?.[0];
    expect(s.purgeOAuth).toHaveBeenCalledTimes(1);
    expect(s.purgeRateLimits).toHaveBeenCalledTimes(1);
  });
});
