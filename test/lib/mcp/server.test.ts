import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import {
  McpServer,
  ToolFailureError,
  tool,
  type McpPrompt,
  type McpResource,
} from '@/lib/mcp/server';

const resources: McpResource<{ readonly who: string }>[] = [
  {
    name: 'me',
    uri: 'test://me',
    description: 'Who.',
    read: async (_p, { who }) => ({ who }),
  },
  {
    name: 'item',
    uriTemplate: 'test://items/{id}',
    description: 'One item.',
    match: (uri) => {
      const id = /^test:\/\/items\/(\d+)$/.exec(uri)?.[1];
      return id ? { id } : undefined;
    },
    read: async ({ id }) => {
      if (id === '0') throw new ToolFailureError('No such item.');
      return { id };
    },
  },
];

const prompts: McpPrompt[] = [
  {
    name: 'hello',
    title: 'Hello',
    description: 'Greets.',
    arguments: [{ name: 'name', description: 'Who.', required: true }],
    render: ({ name }) => `Say hello to ${name}.`,
  },
];

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
        throw new ToolFailureError('No.');
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
  resources,
  prompts,
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
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false },
          },
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
      code: -32_603,
      message: 'Something went wrong.',
    });
  });

  it('refuses an unknown tool', async () => {
    const reply = await call('tools/call', { name: 'nope' });
    expect(reply && 'error' in reply && reply.error.code).toBe(-32_602);
  });

  it('refuses an unknown method', async () => {
    const reply = await call('completion/complete');
    expect(reply && 'error' in reply && reply.error.code).toBe(-32_601);
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

describe('McpServer resources', () => {
  it('lists the fixed resources', async () => {
    const reply = await call('resources/list');
    expect(reply && 'result' in reply && reply.result).toEqual({
      resources: [
        {
          uri: 'test://me',
          name: 'me',
          description: 'Who.',
          mimeType: 'application/json',
        },
      ],
    });
  });

  it('lists the templates', async () => {
    const reply = await call('resources/templates/list');
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      resourceTemplates: [{ uriTemplate: 'test://items/{id}' }],
    });
  });

  it('reads a fixed resource as JSON', async () => {
    const reply = await call('resources/read', { uri: 'test://me' });
    expect(reply && 'result' in reply && reply.result).toEqual({
      contents: [
        { uri: 'test://me', mimeType: 'application/json', text: '{"who":"A"}' },
      ],
    });
  });

  it('reads a templated resource', async () => {
    const reply = await call('resources/read', { uri: 'test://items/4' });
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      contents: [{ text: '{"id":"4"}' }],
    });
  });

  it.each(['test://items/0', 'test://nope'])(
    'answers %s with resource not found',
    async (uri) => {
      const reply = await call('resources/read', { uri });
      expect(reply && 'error' in reply && reply.error.code).toBe(-32_002);
    },
  );

  it('needs a uri', async () => {
    const reply = await call('resources/read');
    expect(reply && 'error' in reply && reply.error.code).toBe(-32_602);
  });
});

describe('McpServer prompts', () => {
  it('lists the prompts with their arguments', async () => {
    const reply = await call('prompts/list');
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      prompts: [
        { name: 'hello', arguments: [{ name: 'name', required: true }] },
      ],
    });
  });

  it('renders a prompt', async () => {
    const reply = await call('prompts/get', {
      name: 'hello',
      arguments: { name: 'B' },
    });
    expect(reply && 'result' in reply && reply.result).toEqual({
      description: 'Greets.',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Say hello to B.' } },
      ],
    });
  });

  it('needs the required arguments', async () => {
    const reply = await call('prompts/get', { name: 'hello' });
    expect(reply && 'error' in reply && reply.error.message).toBe('Send name.');
  });

  it('refuses an unknown prompt', async () => {
    const reply = await call('prompts/get', { name: 'nope' });
    expect(reply && 'error' in reply && reply.error.code).toBe(-32_602);
  });
});
