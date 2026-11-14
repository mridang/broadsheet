import { describe, expect, it } from '@jest/globals';

import { INSTRUCTIONS, SERVER_INFO } from '@/domain/mcp/server-info';

describe('the MCP server', () => {
  it('names itself broadsheet', () => {
    expect(SERVER_INFO.name).toBe('broadsheet');
  });

  it('points assistants at the paper tool', () => {
    expect(INSTRUCTIONS).toContain('read_paper');
  });
});
