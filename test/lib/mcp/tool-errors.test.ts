import { describe, expect, it } from '@jest/globals';

import {
  BackendFailureError,
  InvalidToolArgumentsError,
  UnknownToolError,
} from '@/lib/mcp';

describe('UnknownToolError', () => {
  it('names the tool the caller asked for', () => {
    const error = new UnknownToolError('make_coffee');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnknownToolError');
    expect(error.tool).toBe('make_coffee');
    expect(error.message).toBe('Unknown tool: make_coffee');
  });
});

describe('InvalidToolArgumentsError', () => {
  it('carries each problem and reads them as one message', () => {
    const error = new InvalidToolArgumentsError([
      '`a` is required.',
      '`b` is wrong.',
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidToolArgumentsError');
    expect(error.problems).toEqual(['`a` is required.', '`b` is wrong.']);
    expect(error.message).toBe(
      'Invalid arguments: `a` is required. `b` is wrong.',
    );
  });
});

describe('BackendFailureError', () => {
  it('names the service and keeps the cause out of the message', () => {
    const cause = new Error('secret details');
    const error = new BackendFailureError('Google Drive', cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BackendFailureError');
    expect(error.service).toBe('Google Drive');
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('Google Drive failed');
  });
});
