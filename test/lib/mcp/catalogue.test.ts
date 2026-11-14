import { describe, expect, it } from '@jest/globals';

import { ReadWriteScopes, ToolCatalogue, ToolRegistry } from '@/lib/mcp';
import { CountTool, DeleteTool, FetchTool } from './tool-fixtures';

const catalogue = new ToolCatalogue(
  new ToolRegistry([new CountTool(), new FetchTool(), new DeleteTool()]),
  new ReadWriteScopes('things:read', 'things:write'),
);

describe('ToolCatalogue', () => {
  it('advertises every tool, in the order the registry holds them', () => {
    expect(catalogue.tools.map((tool) => tool.name)).toEqual([
      'count',
      'fetch',
      'delete',
    ]);
  });

  it('carries the title where a host reads it and where an older host reads it', () => {
    const entry = catalogue.named('count');
    expect(entry?.title).toBe('Count things');
    expect(entry?.annotations.title).toBe('Count things');
  });

  it('carries the effects the tool declared', () => {
    expect(catalogue.named('delete')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('says which sign-in a call needs, in the body and in the _meta', () => {
    const schemes = [{ type: 'oauth2', scopes: ['things:read'] }];
    expect(catalogue.named('count')?.securitySchemes).toEqual(schemes);
    expect(catalogue.named('count')?._meta['securitySchemes']).toEqual(schemes);
    expect(catalogue.named('delete')?.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['things:write'] },
    ]);
  });

  it('keeps what a tool adds to its own _meta alongside the sign-in', () => {
    expect(catalogue.named('fetch')?._meta).toEqual({
      'x-widget': 'page',
      securitySchemes: [{ type: 'oauth2', scopes: ['things:read'] }],
    });
  });

  it('advertises an output schema only for the tools that have one', () => {
    expect(catalogue.named('count')?.outputSchema).toEqual({
      type: 'object',
      required: ['count'],
      properties: { count: { type: 'integer' } },
    });
    expect('outputSchema' in (catalogue.named('fetch') ?? {})).toBe(false);
  });

  it('finds nothing for a name no tool has', () => {
    expect(catalogue.named('ghost')).toBeUndefined();
  });
});
