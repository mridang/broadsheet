import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  errorMessage,
  logError,
  logInfo,
  logWarn,
} from '../../../src/lib/util/logging';

type ConsoleSpy = jest.SpiedFunction<typeof console.log>;

/** Parses the first line the spy captured, asserting that one was emitted. */
function firstLine(spy: ConsoleSpy): string {
  const line = spy.mock.calls[0]?.[0];
  expect(typeof line).toBe('string');
  return String(line);
}

function firstRecord(spy: ConsoleSpy): Record<string, unknown> {
  return JSON.parse(firstLine(spy)) as Record<string, unknown>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('structured logging', () => {
  it('logInfo emits exactly one JSON line to console.log', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logInfo({ event: 'torrent.lookup', status: 'ok' });

    expect(log).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();

    const line = firstLine(log);
    expect(line.includes('\n')).toBe(false);

    const parsed = firstRecord(log);
    expect(parsed['level']).toBe('info');
    expect(parsed['event']).toBe('torrent.lookup');
    expect(parsed['status']).toBe('ok');
    expect(typeof parsed['ts']).toBe('string');
    expect(Number.isNaN(Date.parse(parsed['ts'] as string))).toBe(false);
  });

  it('logWarn emits one warn-level line to console.error', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logWarn({ event: 'torrent.lookup' });

    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);

    const parsed = firstRecord(err);
    expect(parsed['level']).toBe('warn');
    expect(parsed['event']).toBe('torrent.lookup');
    expect(typeof parsed['ts']).toBe('string');
  });

  it('logError emits one error-level line to console.error', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logError({ event: 'torrent.lookup' });

    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);

    const parsed = firstRecord(err);
    expect(parsed['level']).toBe('error');
  });

  it('preserves extra fields verbatim', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    logInfo({ event: 'x', count: 3, nested: { a: 1 } });

    const parsed = firstRecord(log);
    expect(parsed['count']).toBe(3);
    expect(parsed['nested']).toEqual({ a: 1 });
  });
});

describe('errorMessage', () => {
  it('gives the message of an Error and the text of anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});
