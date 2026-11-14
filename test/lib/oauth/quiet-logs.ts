import { afterEach, beforeEach, jest } from '@jest/globals';

/** A spy on a `console` method, as the helper below hands it out. */
export type LogSpy = jest.SpiedFunction<typeof console.info>;

/**
 * Keep the OAuth server's security-event lines (`console.info` and
 * `console.warn`) out of a suite's output. Call it once at the top of a test
 * file; the lines are still recorded on the returned spies for tests that want
 * to look at them.
 */
export function quietSecurityLogs(): {
  readonly info: () => LogSpy;
  readonly warn: () => LogSpy;
} {
  const spies: {
    info?: LogSpy;
    warn?: LogSpy;
  } = {};
  beforeEach(() => {
    spies.info = jest.spyOn(console, 'info').mockImplementation(() => {});
    spies.warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    spies.info?.mockRestore();
    spies.warn?.mockRestore();
  });
  return {
    info: () => spies.info as LogSpy,
    warn: () => spies.warn as LogSpy,
  };
}
