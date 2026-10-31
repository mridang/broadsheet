import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { McpServer, ToolFailure, tool } from '@/lib/mcp/server';

const server = new McpServer<{ readonly who: string }>(
  { name: 'test', title: 'Test', version: '1' },
  'Be nice.',
  [
    tool({
      name: 'greet',
      title: 'Greet',
      description: 'Say hello.',
      input: z.object({ name: z.string().describe('Who to greet.') }),
      readOnly: true,
      run: async ({ name }, { who }) => ({ text: `${who} greets ${name}` }),
    }),
    tool({
      name: 'refuse',
      title: 'Refuse',
      description: 'Always says no.',
      input: z.object({}),
      readOnly: false,
      run: async () => {
        throw new ToolFailure('No.');
      },
    }),
    tool({
      name: 'crash',
      title: 'Crash',
      description: 'Fails.',
      input: z.object({}),
      readOnly: false,
      run: async () => {
        throw new Error('database detail');
      },
    }),
  ],
);

const call = (method: string, params: Record<string, unknown> = {}) =>
  server.handleMessage({ jsonrpc: '2.0', id: 1, method, params }, { who: 'A' });

describe('McpServer', () => {
  it('answers initialize with the negotiated version and itself', async () => {
    expect(await call('initialize', { protocolVersion: '2025-06-18' })).toEqual(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'test', title: 'Test', version: '1' },
          instructions: 'Be nice.',
        },
      },
    );
  });

  it('answers ping', async () => {
    expect(await call('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('lists each tool with its JSON Schema and read-only hint', async () => {
    const reply = await call('tools/list');
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      tools: [
        {
          name: 'greet',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Who to greet.' },
            },
            required: ['name'],
          },
          annotations: { readOnlyHint: true },
        },
        { name: 'refuse', annotations: { readOnlyHint: false } },
        { name: 'crash' },
      ],
    });
  });

  it('runs a tool with the context', async () => {
    const reply = await call('tools/call', {
      name: 'greet',
      arguments: { name: 'B' },
    });
    expect(reply && 'result' in reply && reply.result).toEqual({
      content: [{ type: 'text', text: '{"text":"A greets B"}' }],
      structuredContent: { text: 'A greets B' },
    });
  });

  it('reports bad arguments as a tool error', async () => {
    const reply = await call('tools/call', { name: 'greet', arguments: {} });
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('name:') }],
    });
  });

  it('reports a tool failure in its own words', async () => {
    const reply = await call('tools/call', { name: 'refuse' });
    expect(reply && 'result' in reply && reply.result).toEqual({
      content: [{ type: 'text', text: 'No.' }],
      isError: true,
    });
  });

  it('hides an unexpected failure behind a generic error', async () => {
    const reply = await call('tools/call', { name: 'crash' });
    expect(reply && 'error' in reply && reply.error).toEqual({
      code: -32603,
      message: 'Something went wrong.',
    });
  });

  it('refuses an unknown tool', async () => {
    const reply = await call('tools/call', { name: 'nope' });
    expect(reply && 'error' in reply && reply.error.code).toBe(-32602);
  });

  it('refuses an unknown method', async () => {
    const reply = await call('resources/list');
    expect(reply && 'error' in reply && reply.error.code).toBe(-32601);
  });

  it('does not answer a notification', async () => {
    expect(
      await server.handleMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { who: 'A' },
      ),
    ).toBeNull();
  });
});
