import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import {
  McpServer,
  ToolFailureError,
  type McpPrompt,
  type McpResource,
} from '@/lib/mcp/server';
import {
  READS,
  writes,
  NoExplanations,
  ReadWriteScopes,
  ToolCatalogue,
  ToolInvoker,
  ToolRegistry,
  type FailureLog,
} from '@/lib/mcp';
import { JsonTool } from '@/domain/mcp/tools/json-tool';

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

/** What the engine's fixture tools are handed. */
interface Who {
  readonly who: string;
}

/** A tool built the way this app builds them, for the engine's own tests. */
abstract class Fixture<TName extends string> extends JsonTool<TName> {}

class GreetTool extends Fixture<'greet'> {
  readonly name = 'greet';

  readonly title = 'Greet';

  readonly description = 'Say hello.';

  readonly input = z.object({ name: z.string().describe('Who to greet.') });

  readonly annotations = READS;

  protected override async runParsed(
    { name }: { readonly name: string },
    context: unknown,
  ): Promise<object> {
    return { text: `${(context as Who).who} greets ${name}` };
  }
}

class RefuseTool extends Fixture<'refuse'> {
  readonly name = 'refuse';

  readonly title = 'Refuse';

  readonly description = 'Always says no.';

  readonly input = z.object({});

  readonly annotations = writes();

  protected override async runParsed(): Promise<object> {
    throw new ToolFailureError('No.');
  }
}

class CrashTool extends Fixture<'crash'> {
  readonly name = 'crash';

  readonly title = 'Crash';

  readonly description = 'Fails.';

  readonly input = z.object({});

  readonly annotations = writes();

  protected override async runParsed(): Promise<object> {
    throw new Error('database detail');
  }
}

class WreckTool extends Fixture<'wreck'> {
  readonly name = 'wreck';

  readonly title = 'Wreck';

  readonly description = 'Throws something away.';

  readonly input = z.object({});

  readonly annotations = writes({ destructive: true });

  protected override async runParsed(): Promise<object> {
    return { removed: true };
  }
}

const registry = new ToolRegistry<string, never, never>([
  new GreetTool(),
  new RefuseTool(),
  new CrashTool(),
  new WreckTool(),
] as never);

/** A log that drops what it is told, which these tests do not read. */
const log: FailureLog = { record: () => undefined };

const server = new McpServer<{ readonly who: string }>(
  { name: 'test', title: 'Test', version: '1' },
  'Be nice.',
  new ToolCatalogue(registry, new ReadWriteScopes('read', 'write')),
  new ToolInvoker({
    registry,
    failures: new NoExplanations(),
    log,
  }) as never,
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
        { name: 'wreck', annotations: { readOnlyHint: false } },
      ],
    });
  });

  it('warns a host which tools destroy something, and says the others do not', async () => {
    const reply = await call('tools/list');
    const listed = (
      reply && 'result' in reply
        ? (
            reply.result as {
              tools: readonly {
                name: string;
                annotations: { destructiveHint: boolean };
              }[];
            }
          ).tools
        : []
    ).map((t) => [t.name, t.annotations.destructiveHint] as const);
    expect(Object.fromEntries(listed)).toEqual({
      greet: false,
      refuse: false,
      crash: false,
      wreck: true,
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

  it('reports bad arguments as a tool error, naming the tool and what it takes', async () => {
    const reply = await call('tools/call', { name: 'greet', arguments: {} });
    expect(reply && 'result' in reply && reply.result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Invalid arguments for greet: `name` is required. The arguments are: name (required).',
        },
      ],
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
