import { describe, expect, it } from '@jest/globals';

import { ReadWriteScopes } from '@/lib/mcp';
import { CountTool, DeleteTool, FetchTool, RenameTool } from './tool-fixtures';

const scopes = new ReadWriteScopes('things:read', 'things:write');

describe('ReadWriteScopes', () => {
  it('asks only for the read scope for a tool that only reads', () => {
    expect(scopes.scopeFor(new CountTool())).toBe('things:read');
  });

  it('asks only for the read scope even when the tool reads the open web', () => {
    expect(scopes.scopeFor(new FetchTool())).toBe('things:read');
  });

  it('asks for the write scope for a tool that changes something', () => {
    expect(scopes.scopeFor(new RenameTool())).toBe('things:write');
  });

  it('asks for the write scope for a tool that destroys something', () => {
    expect(scopes.scopeFor(new DeleteTool())).toBe('things:write');
  });
});
