import { describe, expect, it } from '@jest/globals';

import {
  SCOPE_READ,
  SCOPE_WRITE,
  hasScope,
  normaliseScope,
  scopeForMessage,
  scopeForTool,
} from '@/lib/oauth';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';

/** The tools that only look, and the ones that change something. */
const READ_ONLY_TOOLS = TOOL_REGISTRY.all
  .filter((tool) => tool.annotations.readOnlyHint === true)
  .map((tool) => tool.name);
const WRITE_TOOLS = TOOL_REGISTRY.all
  .filter((tool) => tool.annotations.readOnlyHint !== true)
  .map((tool) => tool.name);
const [READ_TOOL = ''] = READ_ONLY_TOOLS;
const [WRITE_TOOL = ''] = WRITE_TOOLS;

describe('normaliseScope', () => {
  it('grants everything supported when nothing is asked for', () => {
    expect(normaliseScope(undefined)).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(normaliseScope('  ')).toEqual([SCOPE_READ, SCOPE_WRITE]);
  });

  it('grants only what was asked for', () => {
    expect(normaliseScope(SCOPE_READ)).toEqual([SCOPE_READ]);
  });

  it('drops unknown scopes but keeps the known ones', () => {
    expect(normaliseScope(`${SCOPE_READ} admin offline_access`)).toEqual([
      SCOPE_READ,
    ]);
  });

  it('returns nothing when only unknown scopes are asked for', () => {
    expect(normaliseScope('admin')).toEqual([]);
    expect(normaliseScope('admin offline_access')).toEqual([]);
  });

  it('ignores offline_access: it alone is the same as asking for nothing', () => {
    expect(normaliseScope('offline_access')).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(normaliseScope(`${SCOPE_READ} offline_access`)).toEqual([
      SCOPE_READ,
    ]);
  });
});

describe('hasScope', () => {
  it('lets write cover read but not the other way round', () => {
    expect(hasScope([SCOPE_WRITE], SCOPE_READ)).toBe(true);
    expect(hasScope([SCOPE_READ], SCOPE_WRITE)).toBe(false);
  });

  it('is false with no scopes', () => {
    expect(hasScope([], SCOPE_READ)).toBe(false);
  });
});

describe('scopeForTool', () => {
  it('needs only read for viewing tools', () => {
    expect(READ_ONLY_TOOLS).not.toHaveLength(0);
    for (const tool of READ_ONLY_TOOLS) {
      expect(scopeForTool(tool)).toBe(SCOPE_READ);
    }
  });

  it('needs write for anything that changes data, including unknown tools', () => {
    expect(WRITE_TOOLS).not.toHaveLength(0);
    for (const tool of WRITE_TOOLS) {
      expect(scopeForTool(tool)).toBe(SCOPE_WRITE);
    }
    expect(scopeForTool('not_a_known_tool')).toBe(SCOPE_WRITE);
  });
});

describe('scopeForMessage', () => {
  it('uses the tool being called', () => {
    expect(
      scopeForMessage({ method: 'tools/call', params: { name: READ_TOOL } }),
    ).toBe(SCOPE_READ);
    expect(
      scopeForMessage({ method: 'tools/call', params: { name: WRITE_TOOL } }),
    ).toBe(SCOPE_WRITE);
  });

  it('treats a tool call with no name as a write', () => {
    expect(scopeForMessage({ method: 'tools/call', params: {} })).toBe(
      SCOPE_WRITE,
    );
  });

  it('needs only read for the handshake and listings', () => {
    expect(scopeForMessage({ method: 'initialize' })).toBe(SCOPE_READ);
    expect(scopeForMessage({ method: 'tools/list' })).toBe(SCOPE_READ);
  });
});
