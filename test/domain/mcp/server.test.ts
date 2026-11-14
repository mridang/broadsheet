import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import type { User } from '@/domain/db/users';
import { INSTRUCTIONS, SERVER_INFO } from '@/domain/mcp/app';
import { handleMcpMessage, isAdvertisedTool } from '@/domain/mcp/server';
import { TOOLS } from '@/domain/mcp/tool-definitions';
import type { ToolServices } from '@/domain/mcp/tool-services';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let db: Database;
let services: ToolServices;
const user = { id: 1 } as User;

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  await new Repository(db).upsertUser({ sub: 'g1', email: 'a@b.com' });
  services = { openDatabase: () => db, refresh: () => undefined };
});

/** Send one request and read its reply. */
const call = (method: string, params: Record<string, unknown> = {}) =>
  handleMcpMessage(
    user,
    { jsonrpc: '2.0', id: 1, method, params },
    undefined,
    services,
  );

/** The `result` of a reply, for a reply that has one. */
const resultOf = async (
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  const reply = await call(method, params);
  return (reply as { result: Record<string, unknown> }).result;
};

describe('the handshake', () => {
  it('speaks the revision the client asked for, and says who it is', async () => {
    expect(
      await resultOf('initialize', { protocolVersion: '2025-06-18' }),
    ).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  });

  it('answers ping with nothing to say', async () => {
    expect(await resultOf('ping')).toEqual({});
  });

  it('gives no reply at all to a notification', async () => {
    expect(
      await handleMcpMessage(
        user,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        undefined,
        services,
      ),
    ).toBeNull();
  });

  it('refuses a method it does not know', async () => {
    expect(await call('does/not/exist')).toMatchObject({
      error: { code: -32601 },
    });
  });
});

describe('tools/list', () => {
  it('advertises every registered tool, and nothing else', async () => {
    const listed = (
      (await resultOf('tools/list'))['tools'] as { name: string }[]
    )
      .map((tool) => tool.name)
      .toSorted();
    expect(listed).toEqual([...TOOL_REGISTRY.names].toSorted());
  });

  it('gives each tool a title, a description and an object schema', async () => {
    expect(
      TOOLS.filter(
        (tool) =>
          !tool.title ||
          !tool.description ||
          tool.inputSchema['type'] !== 'object',
      ),
    ).toEqual([]);
  });

  it('knows an advertised tool from anything else', () => {
    expect([
      isAdvertisedTool('list_feeds'),
      isAdvertisedTool('not_a_tool'),
      isAdvertisedTool(7),
    ]).toEqual([true, false, false]);
  });
});

describe('tools/call', () => {
  it('runs a tool with the caller and this app’s services', async () => {
    expect(await resultOf('tools/call', { name: 'list_feeds' })).toMatchObject({
      structuredContent: { feeds: [], sections: [] },
    });
  });

  it('reports arguments a tool cannot take as a tool error', async () => {
    expect(
      await resultOf('tools/call', {
        name: 'get_feed',
        arguments: { feed_id: 'not a number' },
      }),
    ).toMatchObject({ isError: true });
  });

  it('refuses a tool it does not advertise', async () => {
    expect(
      await call('tools/call', { name: 'not_a_tool', arguments: {} }),
    ).toMatchObject({ error: { code: -32602 } });
  });
});

describe('resources', () => {
  it('lists the fixed addresses and the templated ones apart', async () => {
    const fixed = (
      (await resultOf('resources/list'))['resources'] as { uri: string }[]
    ).map((resource) => resource.uri);
    const templates = (
      (await resultOf('resources/templates/list'))['resourceTemplates'] as {
        uriTemplate: string;
      }[]
    ).map((template) => template.uriTemplate);
    expect([
      fixed.includes('broadsheet://feeds'),
      templates.includes('broadsheet://feeds/{feed_id}'),
      fixed.some((uri) => uri.includes('{')),
    ]).toEqual([true, true, false]);
  });

  it('reads a fixed resource as JSON', async () => {
    const contents = (
      await resultOf('resources/read', { uri: 'broadsheet://feeds' })
    )['contents'] as { uri: string; mimeType: string; text: string }[];
    expect([contents[0]?.uri, contents[0]?.mimeType]).toEqual([
      'broadsheet://feeds',
      'application/json',
    ]);
    expect(JSON.parse(contents[0]?.text ?? '')).toEqual({ feeds: [] });
  });

  it('refuses an address no resource answers to', async () => {
    expect(
      await call('resources/read', { uri: 'broadsheet://nothing' }),
    ).toMatchObject({ error: { code: -32602 } });
  });

  it('needs an address at all', async () => {
    expect(await call('resources/read')).toMatchObject({
      error: { code: -32602 },
    });
  });
});

describe('prompts', () => {
  it('lists each prompt with its arguments', async () => {
    const listed = (await resultOf('prompts/list'))['prompts'] as {
      name: string;
      arguments: unknown[];
    }[];
    expect(
      listed.find((prompt) => prompt.name === 'research_topic')?.arguments,
    ).toEqual([
      { name: 'topic', description: 'What to research.', required: true },
    ]);
  });

  it('renders a prompt with the argument filled in', async () => {
    const rendered = await resultOf('prompts/get', {
      name: 'research_topic',
      arguments: { topic: 'rust' },
    });
    expect(
      JSON.stringify((rendered as { messages: unknown }).messages),
    ).toContain('rust');
  });

  it('refuses a prompt that is missing a required argument', async () => {
    expect(
      await call('prompts/get', { name: 'research_topic', arguments: {} }),
    ).toMatchObject({ error: { code: -32602 } });
  });

  it('refuses an unknown prompt', async () => {
    expect(await call('prompts/get', { name: 'not_a_prompt' })).toMatchObject({
      error: { code: -32602 },
    });
  });
});
