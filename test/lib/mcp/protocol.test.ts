import { describe, expect, it } from '@jest/globals';

import {
  ERROR_HEADER_MISMATCH,
  ERROR_INVALID_PARAMS,
  ERROR_INVALID_REQUEST,
  ERROR_UNSUPPORTED_VERSION,
  MODERN_VERSION,
  RpcError,
  SUPPORTED_VERSIONS,
  checkBatch,
  checkRequestHeaders,
  declaredVersion,
  decodeHeaderValue,
  errorBody,
  headerVersion,
  isAllowedOrigin,
  isModernRequest,
  isNotification,
  isPlainObject,
  negotiateLegacyVersion,
  parseAllowedOrigins,
  parseMessage,
  protocolRefusal,
  replyIdOf,
  withoutId,
} from '@/lib/mcp';
import urls from '../../fixtures/insecure-urls.json' with { type: 'json' };

const META = 'io.modelcontextprotocol/protocolVersion';
const CAPS = 'io.modelcontextprotocol/clientCapabilities';
const modern = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0' as const,
  id: 1,
  method,
  params: { ...params, _meta: { [META]: MODERN_VERSION, [CAPS]: {} } },
});
const headers = (h: Record<string, string>) => new Headers(h);
const good = { 'mcp-protocol-version': MODERN_VERSION };

describe('negotiateLegacyVersion', () => {
  it('answers with the version the client asked for when we speak it', () => {
    expect(negotiateLegacyVersion('2025-06-18')).toBe('2025-06-18');
    expect(negotiateLegacyVersion('2024-11-05')).toBe('2024-11-05');
  });

  it('answers with our newest older version otherwise', () => {
    expect(negotiateLegacyVersion('1999-01-01')).toBe('2025-11-25');
    expect(negotiateLegacyVersion(undefined)).toBe('2025-11-25');
    expect(negotiateLegacyVersion(42)).toBe('2025-11-25');
  });

  it('does not hand out the newest revision, which has no handshake', () => {
    expect(negotiateLegacyVersion(MODERN_VERSION)).toBe('2025-11-25');
  });
});

describe('declaredVersion / isModernRequest', () => {
  it('reads the version a request carries in its _meta', () => {
    expect(declaredVersion(modern('tools/list'))).toBe(MODERN_VERSION);
    expect(isModernRequest(modern('tools/list'))).toBe(true);
  });

  it('treats a request without one as an older request', () => {
    expect(isModernRequest({ method: 'initialize', params: {} })).toBe(false);
    expect(isModernRequest({ method: 'ping' })).toBe(false);
  });

  it('does not take an older version named per request for the newest era', () => {
    const message = {
      method: 'ping',
      params: { _meta: { [META]: '2025-11-25' } },
    };
    expect(declaredVersion(message)).toBe('2025-11-25');
    expect(isModernRequest(message)).toBe(false);
  });

  it('ignores a version that is not text', () => {
    const message = {
      method: 'ping',
      params: { _meta: { [META]: 20_260_728 } },
    };
    expect(declaredVersion(message)).toBeUndefined();
    expect(isModernRequest(message)).toBe(false);
  });
});

describe('replyIdOf', () => {
  it('keeps strings and integers', () => {
    expect(replyIdOf('abc')).toBe('abc');
    expect(replyIdOf('')).toBe('');
    expect(replyIdOf(0)).toBe(0);
    expect(replyIdOf(-4)).toBe(-4);
  });

  it.each([
    [null],
    [undefined],
    [1.5],
    [true],
    [{ a: 1 }],
    [[1]],
    [Number.NaN],
    [1e300],
  ])('has no id to echo for %p', (value) => {
    expect(replyIdOf(value)).toBeNull();
  });
});

describe('isPlainObject / isNotification', () => {
  it('tells objects from everything else', () => {
    expect(isPlainObject({})).toBe(true);
    for (const value of [null, [], 'x', 1, undefined, true]) {
      expect(isPlainObject(value)).toBe(false);
    }
  });

  it('calls a message a notification by its method', () => {
    expect(isNotification({ method: 'notifications/initialized' })).toBe(true);
    expect(isNotification({ method: 'tools/list' })).toBe(false);
    expect(isNotification({})).toBe(false);
  });
});

describe('RpcError', () => {
  it('carries a code and the detail for the caller', () => {
    const error = new RpcError(-32_602, 'bad', { uri: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'RpcError',
      code: -32_602,
      message: 'bad',
      data: { uri: 'x' },
    });
  });
});

describe('refusals', () => {
  it('build an HTTP status with a JSON-RPC body that has no id unless one is given', () => {
    expect(
      protocolRefusal({ status: 400, code: -32_600, message: 'no' }),
    ).toEqual({
      status: 400,
      body: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32_600, message: 'no' },
      },
    });
    expect(
      protocolRefusal({
        status: 429,
        code: -32_603,
        message: 'slow',
        id: 5,
        data: { retryAfterSeconds: 3 },
        headers: { 'Retry-After': '3' },
      }),
    ).toEqual({
      status: 429,
      headers: { 'Retry-After': '3' },
      body: {
        jsonrpc: '2.0',
        id: 5,
        error: {
          code: -32_603,
          message: 'slow',
          data: { retryAfterSeconds: 3 },
        },
      },
    });
  });

  it('can drop the id, as a reply to a whole batch must', () => {
    const refusal = protocolRefusal({
      status: 400,
      code: -32_020,
      message: 'm',
      id: 9,
    });
    expect(withoutId(refusal).body.id).toBeNull();
    expect(withoutId(refusal).status).toBe(400);
  });

  it('make an error body on their own', () => {
    expect(errorBody(-32_601, 'Method not found', 2)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32_601, message: 'Method not found' },
    });
  });
});

describe('parseMessage', () => {
  const refusalOf = (raw: unknown) => {
    const parsed = parseMessage(raw);
    return parsed.kind === 'invalid' ? parsed.refusal : undefined;
  };

  it('accepts a request and a notification', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' })).toEqual({
      kind: 'request',
      message: { jsonrpc: '2.0', id: 'a', method: 'ping' },
    });
    expect(
      parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toMatchObject({ kind: 'notification' });
  });

  it('keeps the params of a request', () => {
    expect(
      parseMessage({ jsonrpc: '2.0', id: 1, method: 'x', params: { a: 1 } }),
    ).toMatchObject({ message: { params: { a: 1 } } });
  });

  it('lets a notification that carries an id be a notification', () => {
    expect(
      parseMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'notifications/cancelled',
      }),
    ).toMatchObject({ kind: 'notification' });
  });

  it('recognises replies, which are not for us to answer', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 3, result: {} })).toEqual({
      kind: 'response',
    });
    expect(
      parseMessage({ jsonrpc: '2.0', id: 3, error: { code: 1, message: '' } }),
    ).toEqual({ kind: 'response' });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a number', 7],
    ['a string', 'ping'],
  ])('refuses %s as an invalid request', (_name, raw) => {
    expect(refusalOf(raw)?.body.error.code).toBe(ERROR_INVALID_REQUEST);
  });

  it.each([
    ['no jsonrpc member', { id: 1, method: 'ping' }],
    ['jsonrpc 1.0', { jsonrpc: '1.0', id: 1, method: 'ping' }],
    ['a numeric jsonrpc', { jsonrpc: 2, id: 1, method: 'ping' }],
    ['no method', { jsonrpc: '2.0', id: 1 }],
    ['a method that is not text', { jsonrpc: '2.0', id: 1, method: 5 }],
    ['an empty method', { jsonrpc: '2.0', id: 1, method: '' }],
  ])('refuses a message with %s, naming its id', (_name, raw) => {
    const refusal = refusalOf(raw);
    expect(refusal?.status).toBe(400);
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(refusal?.body.id).toBe(1);
  });

  it.each([
    ['null', null],
    ['an object', { a: 1 }],
    ['a boolean', true],
    ['a fraction', 1.5],
  ])('refuses %s as an id, and has no id to echo', (_name, id) => {
    const refusal = refusalOf({ jsonrpc: '2.0', id, method: 'ping' });
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(refusal?.body.id).toBeNull();
  });

  it('refuses a request method sent without an id, because it would run and be answered to nobody', () => {
    const refusal = refusalOf({ jsonrpc: '2.0', method: 'tools/list' });
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_REQUEST);
    expect(refusal?.body.error.message).toContain('needs an "id"');
  });

  it.each([
    ['an array', [1]],
    ['text', 'x'],
  ])('refuses params that are %s', (_name, params) => {
    const refusal = refusalOf({ jsonrpc: '2.0', id: 4, method: 'x', params });
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_PARAMS);
    expect(refusal?.body.id).toBe(4);
  });

  it('reads params of null as no params, because some clients send that for methods without any', () => {
    const parsed = parseMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: null,
    });
    expect(parsed).toEqual({
      kind: 'request',
      message: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
  });

  it('refuses _meta that is not an object', () => {
    const refusal = refusalOf({
      jsonrpc: '2.0',
      id: 4,
      method: 'x',
      params: { _meta: 'nope' },
    });
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_PARAMS);
  });
});

describe('headerVersion', () => {
  it('reads the trimmed header, and nothing when it is absent or blank', () => {
    expect(
      headerVersion(new Headers({ 'mcp-protocol-version': ' 2025-06-18 ' })),
    ).toBe('2025-06-18');
    expect(headerVersion(new Headers())).toBeUndefined();
    expect(
      headerVersion(new Headers({ 'mcp-protocol-version': ' ' })),
    ).toBeUndefined();
  });
});

describe('checkBatch', () => {
  const legacy = { jsonrpc: '2.0' as const, id: 1, method: 'ping' };

  it('allows a batch for the older revisions', () => {
    expect(checkBatch(new Headers(), [legacy, legacy])).toBeNull();
    expect(
      checkBatch(new Headers({ 'mcp-protocol-version': '2025-03-26' }), [
        legacy,
      ]),
    ).toBeNull();
  });

  it('lets an initialize ride in a batch of the older revisions, which is harmless over-acceptance', () => {
    expect(
      checkBatch(headers({}), [
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ]),
    ).toBeNull();
  });

  it('refuses a batch that says it is newest-era in its header or in any message', () => {
    expect(
      checkBatch(new Headers({ 'mcp-protocol-version': MODERN_VERSION }), [
        legacy,
      ])?.body.error.code,
    ).toBe(ERROR_INVALID_REQUEST);
    expect(checkBatch(new Headers(), [legacy, modern('ping')])?.status).toBe(
      400,
    );
  });
});

describe('checkRequestHeaders', () => {
  it('accepts an older request with no protocol headers at all', () => {
    expect(
      checkRequestHeaders(headers({}), { method: 'tools/list', id: 1 }),
    ).toBeNull();
  });

  it('accepts an older request that names a version we speak', () => {
    expect(
      checkRequestHeaders(headers({ 'mcp-protocol-version': '2025-06-18' }), {
        method: 'tools/list',
      }),
    ).toBeNull();
  });

  it('refuses a version header we do not speak, listing the ones we do', () => {
    const refusal = checkRequestHeaders(
      headers({ 'mcp-protocol-version': '1999-01-01' }),
      { method: 'tools/list' },
    )!;
    expect(refusal.status).toBe(400);
    expect(refusal.body.error.code).toBe(ERROR_UNSUPPORTED_VERSION);
    expect(refusal.body.error.data).toEqual({
      supported: SUPPORTED_VERSIONS,
      requested: '1999-01-01',
    });
  });

  it('refuses a body version we do not speak', () => {
    const message = modern('tools/list');
    message.params._meta[META] = '2099-01-01' as typeof MODERN_VERSION;
    expect(
      checkRequestHeaders(
        headers({ 'mcp-protocol-version': '2099-01-01' }),
        message,
      )!.body.error.code,
    ).toBe(ERROR_UNSUPPORTED_VERSION);
  });

  it('accepts a newest-era request whose headers match its body', () => {
    expect(
      checkRequestHeaders(
        headers({ ...good, 'mcp-method': 'tools/list' }),
        modern('tools/list'),
      ),
    ).toBeNull();
  });

  it.each([
    ['no version header', {}, 'tools/list'],
    [
      'a version header that differs from the body',
      { 'mcp-protocol-version': '2025-11-25', 'mcp-method': 'tools/list' },
      'tools/list',
    ],
    ['no method header', good, 'tools/list'],
    [
      'a method header that differs from the body',
      { ...good, 'mcp-method': 'ping' },
      'tools/list',
    ],
  ])('refuses a newest-era request with %s', (_name, h, method) => {
    const refusal = checkRequestHeaders(headers(h), modern(method))!;
    expect(refusal.status).toBe(400);
    expect(refusal.body.error.code).toBe(ERROR_HEADER_MISMATCH);
  });

  it('requires Mcp-Name to match the tool or resource a call names', () => {
    const call = modern('tools/call', { name: 'get_recipe' });
    const base = { ...good, 'mcp-method': 'tools/call' };
    expect(
      checkRequestHeaders(headers({ ...base, 'mcp-name': 'get_recipe' }), call),
    ).toBeNull();
    expect(
      checkRequestHeaders(headers({ ...base, 'mcp-name': 'other' }), call)!
        .status,
    ).toBe(400);
    expect(checkRequestHeaders(headers(base), call)!.status).toBe(400);
    const read = modern('resources/read', { uri: 'ui://x' });
    expect(
      checkRequestHeaders(
        headers({
          ...good,
          'mcp-method': 'resources/read',
          'mcp-name': 'ui://x',
        }),
        read,
      ),
    ).toBeNull();
  });

  it('requires Mcp-Name to match the prompt a prompts/get names', () => {
    const get = modern('prompts/get', { name: 'weeknight' });
    const base = { ...good, 'mcp-method': 'prompts/get' };
    expect(
      checkRequestHeaders(headers({ ...base, 'mcp-name': 'weeknight' }), get),
    ).toBeNull();
    const refusal = checkRequestHeaders(
      headers({ ...base, 'mcp-name': 'other' }),
      get,
    );
    expect(refusal?.body.error.code).toBe(ERROR_HEADER_MISMATCH);
    expect(refusal?.body.id).toBe(1);
  });

  it('calls an Mcp-Name that is not valid base64 a mismatch', () => {
    const refusal = checkRequestHeaders(
      headers({
        ...good,
        'mcp-method': 'tools/call',
        'mcp-name': '=?base64?!!!?=',
      }),
      modern('tools/call', { name: 'get_recipe' }),
    );
    expect(refusal?.status).toBe(400);
    expect(refusal?.body.error.code).toBe(ERROR_HEADER_MISMATCH);
  });

  it('decodes a base64 Mcp-Name before comparing', () => {
    const name = 'crème brûlée';
    const encoded = `=?base64?${Buffer.from(name).toString('base64')}?=`;
    expect(
      checkRequestHeaders(
        headers({ ...good, 'mcp-method': 'tools/call', 'mcp-name': encoded }),
        modern('tools/call', { name }),
      ),
    ).toBeNull();
  });
});

describe('checkRequestHeaders — refusals name the request', () => {
  it('echo the id on a header mismatch, an unsupported version and a bad Mcp-Name', () => {
    const wrongMethod = checkRequestHeaders(
      headers({ ...good, 'mcp-method': 'ping' }),
      { ...modern('tools/list'), id: 'req-7' },
    );
    expect(wrongMethod?.body.id).toBe('req-7');
    const wrongVersion = checkRequestHeaders(
      headers({ 'mcp-protocol-version': '1999-01-01' }),
      { method: 'ping', id: 12 },
    );
    expect(wrongVersion?.body.id).toBe(12);
    const wrongName = checkRequestHeaders(
      headers({ ...good, 'mcp-method': 'tools/call', 'mcp-name': 'x' }),
      { ...modern('tools/call', { name: 'get_recipe' }), id: 3 },
    );
    expect(wrongName?.body.id).toBe(3);
  });

  it('leave the id null when the request had none that could be read', () => {
    const refusal = checkRequestHeaders(
      headers({ 'mcp-protocol-version': '1999-01-01' }),
      { method: 'ping', id: null },
    );
    expect(refusal?.body.id).toBeNull();
  });
});

describe('checkRequestHeaders — per-request metadata', () => {
  const unspeakable = {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/list',
    params: { _meta: { [META]: 'v999.0.0', [CAPS]: {} } },
  };

  it('calls a header that names another version than the body a mismatch, even when the body names one we do not speak', () => {
    const refusal = checkRequestHeaders(headers(good), unspeakable);
    expect(refusal?.status).toBe(400);
    expect(refusal?.body.error.code).toBe(-32_020);
  });

  it('still calls a version we do not speak unsupported when there is no header to disagree with', () => {
    const refusal = checkRequestHeaders(headers({}), unspeakable);
    expect(refusal?.body.error.code).toBe(-32_022);
  });

  it('calls a version we do not speak unsupported when the header says the same', () => {
    const refusal = checkRequestHeaders(
      headers({ 'mcp-protocol-version': 'v999.0.0' }),
      unspeakable,
    );
    expect(refusal?.body.error.code).toBe(-32_022);
  });

  const withMeta = (meta: Record<string, unknown>, id = 1) => ({
    jsonrpc: '2.0' as const,
    id,
    method: 'tools/list',
    params: { _meta: meta },
  });
  const modernHeaders = headers({ ...good, 'mcp-method': 'tools/list' });

  it('requires the client’s capabilities, as an object', () => {
    for (const caps of [undefined, null, 'x', [], 5]) {
      const refusal = checkRequestHeaders(
        modernHeaders,
        withMeta({ [META]: MODERN_VERSION, [CAPS]: caps }),
      );
      expect(refusal?.status).toBe(400);
      expect(refusal?.body.error.code).toBe(ERROR_INVALID_PARAMS);
      expect(refusal?.body.id).toBe(1);
    }
  });

  it('accepts empty capabilities', () => {
    expect(
      checkRequestHeaders(
        modernHeaders,
        withMeta({ [META]: MODERN_VERSION, [CAPS]: {} }),
      ),
    ).toBeNull();
  });

  it('refuses a version that is not text', () => {
    const refusal = checkRequestHeaders(
      modernHeaders,
      withMeta({ [META]: 20_260_728, [CAPS]: {} }),
    );
    expect(refusal?.status).toBe(400);
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_PARAMS);
  });

  it('refuses a version header for the newest revision when the body has no metadata', () => {
    const refusal = checkRequestHeaders(modernHeaders, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/list',
    });
    expect(refusal?.status).toBe(400);
    expect(refusal?.body.error.code).toBe(ERROR_INVALID_PARAMS);
    expect(refusal?.body.id).toBe(8);
  });

  it('refuses an older version named per request, which only exists after initialize', () => {
    for (const version of ['2025-11-25', '2024-11-05']) {
      const refusal = checkRequestHeaders(
        headers({ 'mcp-protocol-version': version }),
        withMeta({ [META]: version, [CAPS]: {} }),
      );
      expect(refusal?.status).toBe(400);
      expect(refusal?.body.error.code).toBe(ERROR_UNSUPPORTED_VERSION);
      expect(refusal?.body.error.message).toContain('initialize');
      expect(refusal?.body.error.data).toEqual({
        supported: SUPPORTED_VERSIONS,
        requested: version,
      });
    }
  });

  it('asks nothing more of a notification', () => {
    expect(
      checkRequestHeaders(headers({}), {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: { _meta: { [META]: MODERN_VERSION } },
      }),
    ).toBeNull();
  });

  it('still turns away a notification whose version header we do not speak', () => {
    expect(
      checkRequestHeaders(headers({ 'mcp-protocol-version': '1999-01-01' }), {
        method: 'notifications/initialized',
      })?.body.error.code,
    ).toBe(ERROR_UNSUPPORTED_VERSION);
  });
});

describe('decodeHeaderValue', () => {
  it('passes plain values through and decodes the base64 form', () => {
    expect(decodeHeaderValue('plain')).toBe('plain');
    expect(decodeHeaderValue('=?base64?SGk=?=')).toBe('Hi');
    expect(decodeHeaderValue(null)).toBeUndefined();
    expect(decodeHeaderValue('=?base64?!!!?=')).toBeUndefined();
  });
});

describe('isAllowedOrigin', () => {
  const self = 'https://site.example';

  it('lets through a request with no Origin and our own origin', () => {
    expect(isAllowedOrigin(null, self)).toBe(true);
    expect(isAllowedOrigin(self, self)).toBe(true);
  });

  it('lets through the assistants’ web apps and local tools', () => {
    for (const origin of [
      'https://claude.ai',
      'https://www.claude.ai',
      'https://chatgpt.com',
      'https://chat.openai.com',
      'http://localhost:6274',
      'http://127.0.0.1:3000',
    ]) {
      expect(isAllowedOrigin(origin, self)).toBe(true);
    }
  });

  it('turns away everything else, including look-alikes', () => {
    for (const origin of [
      'https://evil.example',
      'https://claude.ai.evil.example',
      'https://notclaude.ai',
      urls.claudeAi,
      'https://claude.ai/path',
      'null',
      'not a url',
    ]) {
      expect(isAllowedOrigin(origin, self)).toBe(false);
    }
  });

  it('can be extended from the environment', () => {
    expect(
      isAllowedOrigin(
        'https://tool.example',
        self,
        'https://tool.example, https://b.example',
      ),
    ).toBe(true);
    expect(
      isAllowedOrigin('https://other.example', self, 'https://tool.example'),
    ).toBe(false);
  });

  // The URL parser reports an opaque origin for every scheme but http(s), so
  // these were refused before the setting was even read.
  it.each([
    'chrome-extension://abcdef',
    'moz-extension://abcdef',
    'vscode-webview://abc',
    'app://obsidian.md',
    'tauri://localhost',
  ])('admits %s when the operator lists it, and not otherwise', (origin) => {
    expect(isAllowedOrigin(origin, self, `https://x.example,${origin}`)).toBe(
      true,
    );
    expect(isAllowedOrigin(origin, self, 'https://x.example')).toBe(false);
    expect(isAllowedOrigin(origin, self)).toBe(false);
  });

  it.each(['*', 'null', ' * , null '])(
    'ignores %j in the setting, so nothing can switch the check off',
    (setting) => {
      expect(isAllowedOrigin('null', self, setting)).toBe(false);
      expect(isAllowedOrigin('https://evil.example', self, setting)).toBe(
        false,
      );
    },
  );

  it('matches a listed origin exactly: the port and the scheme count', () => {
    const setting = 'https://tool.example';
    expect(isAllowedOrigin('https://tool.example:8443', self, setting)).toBe(
      false,
    );
    expect(isAllowedOrigin(urls.toolExample, self, setting)).toBe(false);
    expect(isAllowedOrigin('https://sub.tool.example', self, setting)).toBe(
      false,
    );
  });

  it('keeps the built-in rules when a setting is given', () => {
    expect(isAllowedOrigin('https://claude.ai', self, 'app://x')).toBe(true);
    expect(isAllowedOrigin('https://claude.ai/path', self, 'app://x')).toBe(
      false,
    );
  });
});

describe('parseAllowedOrigins', () => {
  it('splits on commas, trims, and drops blanks, * and null', () => {
    expect(
      parseAllowedOrigins(' https://a.example ,, app://b , * , null ,'),
    ).toEqual(['https://a.example', 'app://b']);
  });

  it('is empty when there is no setting', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });
});
