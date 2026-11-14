import { describe, expect, it } from '@jest/globals';

import { ToolRegistry } from '@/lib/mcp';
import { CountTool, DeleteTool, FetchTool } from './tool-fixtures';

const registry = new ToolRegistry([
  new CountTool(),
  new FetchTool(),
  new DeleteTool(),
]);

describe('ToolRegistry', () => {
  it('keeps the tools in the order they were registered', () => {
    expect(registry.names).toEqual(['count', 'fetch', 'delete']);
    expect(registry.all.map((tool) => tool.title)).toEqual([
      'Count things',
      'Fetch a page',
      'Delete a thing',
    ]);
  });

  it('finds a tool by the name an assistant calls', () => {
    expect(registry.named('fetch')?.title).toBe('Fetch a page');
    expect(registry.has('fetch')).toBe(true);
  });

  it('finds nothing for a name no tool has', () => {
    expect(registry.named('ghost')).toBeUndefined();
    expect(registry.has('ghost')).toBe(false);
  });

  it('finds nothing for an inherited property name, which a caller may send', () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(registry.named(name)).toBeUndefined();
      expect(registry.has(name)).toBe(false);
    }
  });

  it('refuses two tools of one name, rather than letting one shadow the other', () => {
    expect(() => new ToolRegistry([new CountTool(), new CountTool()])).toThrow(
      'Two tools are called count.',
    );
  });

  it('holds no tools at all without complaining', () => {
    const empty = new ToolRegistry([]);
    expect(empty.all).toEqual([]);
    expect(empty.names).toEqual([]);
    expect(empty.named('count')).toBeUndefined();
  });
});
