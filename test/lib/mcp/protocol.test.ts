import { describe, expect, it } from '@jest/globals';

import {
  errorReply,
  isJsonRpcMessage,
  isNotification,
  negotiateVersion,
  replyIdOf,
} from '@/lib/mcp/protocol';

describe('negotiateVersion', () => {
  it.each([
    ['2025-06-18', '2025-06-18'],
    ['1999-01-01', '2025-11-25'],
    [undefined, '2025-11-25'],
  ])('answers %s with %s', (requested, expected) => {
    expect(negotiateVersion(requested)).toBe(expected);
  });
});

describe('isJsonRpcMessage', () => {
  it.each([
    [{ jsonrpc: '2.0', id: 1, method: 'ping' }, true],
    [{ jsonrpc: '2.0', method: 'notifications/initialized' }, true],
    [{ jsonrpc: '1.0', id: 1, method: 'ping' }, false],
    [{ jsonrpc: '2.0', id: 1 }, false],
    [{ jsonrpc: '2.0', id: {}, method: 'ping' }, false],
    [{ jsonrpc: '2.0', id: 1, method: 'ping', params: [] }, false],
    [[], false],
  ])('%j is %s', (message, expected) => {
    expect(isJsonRpcMessage(message)).toBe(expected);
  });
});

describe('isNotification', () => {
  it('is a message with no id', () => {
    expect(isNotification({ method: 'x' })).toBe(true);
  });
});

describe('replyIdOf', () => {
  it.each([
    [1, 1],
    ['a', 'a'],
    [undefined, null],
  ])('%j is %j', (id, expected) => {
    expect(replyIdOf(id)).toBe(expected);
  });
});

describe('errorReply', () => {
  it('leaves out data it was not given', () => {
    expect(errorReply(1, -1, 'No')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -1, message: 'No' },
    });
  });
});
