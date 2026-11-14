import { describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_DOCUMENT_TTL_SECONDS,
  FETCH_USER_AGENT,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TTL_SECONDS,
  MAX_STALE_DOCUMENT_SECONDS,
  MIN_DOCUMENT_TTL_SECONDS,
  documentTtlSeconds,
  fetchClientMetadata,
  isClientBusy,
  isDocumentFresh,
  isDocumentUsable,
  isMetadataDocumentUrl,
  readCappedText,
  parseClientMetadataDocument,
  MAX_REGISTRATION_BYTES,
  parseRegistration,
  parseRegistrationText,
  registrationResponse,
} from '@/lib/oauth';
import { SITE_NAME } from '@/utils/site';
import urls from '../../fixtures/insecure-urls.json' with { type: 'json' };

const URL_ID = 'https://chatgpt.com/oauth/client.json';
const goodDoc = {
  client_id: URL_ID,
  client_name: 'ChatGPT',
  redirect_uris: ['https://chatgpt.com/cb'],
  token_endpoint_auth_method: 'none',
};

/** What https://chatgpt.com/oauth/client.json served when ChatGPT was first refused. */
const CHATGPT_DOCUMENT = {
  client_id: 'https://chatgpt.com/oauth/client.json',
  client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};

describe('isMetadataDocumentUrl', () => {
  it('accepts an https URL with a path', () => {
    expect(isMetadataDocumentUrl(URL_ID)).toBe(true);
  });

  it('rejects plain ids, http, bare hosts, IPs, localhost and dot segments', () => {
    expect(isMetadataDocumentUrl('dcr_abc123')).toBe(false);
    expect(isMetadataDocumentUrl(urls.chatgptClient)).toBe(false);
    expect(isMetadataDocumentUrl('https://chatgpt.com')).toBe(false);
    expect(isMetadataDocumentUrl('https://chatgpt.com/')).toBe(false);
    expect(isMetadataDocumentUrl('https://10.0.0.1/client.json')).toBe(false);
    expect(isMetadataDocumentUrl('https://localhost/client.json')).toBe(false);
    expect(isMetadataDocumentUrl('https://a.com/x/../client.json')).toBe(false);
    expect(isMetadataDocumentUrl('https://a.com/c.json#x')).toBe(false);
  });
});

describe('parseClientMetadataDocument', () => {
  it('accepts a valid document', () => {
    const result = parseClientMetadataDocument(goodDoc, URL_ID);
    expect(result).toMatchObject({
      ok: true,
      client: {
        clientId: URL_ID,
        name: 'ChatGPT',
        redirectUris: ['https://chatgpt.com/cb'],
        kind: 'cimd',
      },
    });
  });

  it('rejects a document whose client_id is not the URL it came from', () => {
    const result = parseClientMetadataDocument(
      { ...goodDoc, client_id: 'https://evil.example/client.json' },
      URL_ID,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects missing or unsafe redirect URIs', () => {
    expect(
      parseClientMetadataDocument({ ...goodDoc, redirect_uris: [] }, URL_ID).ok,
    ).toBe(false);
    expect(
      parseClientMetadataDocument(
        { ...goodDoc, redirect_uris: ['javascript:alert(1)'] },
        URL_ID,
      ).ok,
    ).toBe(false);
  });

  it('rejects clients that need a secret', () => {
    expect(
      parseClientMetadataDocument(
        { ...goodDoc, token_endpoint_auth_method: 'client_secret_basic' },
        URL_ID,
      ).ok,
    ).toBe(false);
  });

  it('reads the published ChatGPT document as a client that signs its requests', () => {
    expect(parseClientMetadataDocument(CHATGPT_DOCUMENT, URL_ID)).toEqual({
      ok: true,
      client: {
        clientId: URL_ID,
        name: 'ChatGPT',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        kind: 'cimd',
        auth: {
          method: 'private_key_jwt',
          jwksUri: 'https://chatgpt.com/oauth/jwks.json',
        },
        logoUri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
      },
    });
  });

  it.each([
    ['an http address', urls.exampleLogo],
    ['an address with a login', 'https://user:pw@example.com/logo.png'],
    ['an address on a private network', 'https://192.168.0.1/logo.png'],
    ['an address that is not normalised', 'https://EXAMPLE.com/a/../logo.png'],
    ['text that is not an address', 'not a url'],
    ['something that is not text', 42],
  ])('leaves the logo out for %s', (_label, logoUri) => {
    const result = parseClientMetadataDocument(
      { ...goodDoc, logo_uri: logoUri },
      URL_ID,
    );
    expect(result.ok && result.client).not.toHaveProperty('logoUri');
    expect(result.ok).toBe(true);
  });

  it('holds a client to private_key_jwt even when it also lists none', () => {
    const result = parseClientMetadataDocument(CHATGPT_DOCUMENT, URL_ID);
    expect(result.ok && result.client.auth?.method).toBe('private_key_jwt');
  });

  it.each([
    ['an http jwks_uri', { jwks_uri: urls.chatgptJwks }],
    ['a jwks_uri with credentials', { jwks_uri: 'https://u:p@chatgpt.com/k' }],
    ['a jwks_uri that is not a URL', { jwks_uri: 'keys' }],
    ['a jwks_uri that is not text', { jwks_uri: 7 }],
    [
      'a signing algorithm we do not accept',
      { token_endpoint_auth_signing_alg: 'HS256' },
    ],
    ['the algorithm none', { token_endpoint_auth_signing_alg: 'none' }],
  ])('rejects a private_key_jwt client with %s', (_name, change) => {
    const result = parseClientMetadataDocument(
      { ...CHATGPT_DOCUMENT, ...change },
      URL_ID,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a private_key_jwt client that sends no jwks_uri', () => {
    const document = withoutKey(CHATGPT_DOCUMENT, 'jwks_uri');
    expect(parseClientMetadataDocument(document, URL_ID).ok).toBe(false);
  });

  it('accepts a private_key_jwt client that names no algorithm', () => {
    const document = withoutKey(
      CHATGPT_DOCUMENT,
      'token_endpoint_auth_signing_alg',
    );
    expect(parseClientMetadataDocument(document, URL_ID).ok).toBe(true);
  });

  it('treats a document that names no method as a public client', () => {
    const document = withoutKey(goodDoc, 'token_endpoint_auth_method');
    const result = parseClientMetadataDocument(document, URL_ID);
    expect(result.ok && result.client.auth).toBeUndefined();
  });

  it('falls back to the host as the name and caps its length', () => {
    const { client } = parseClientMetadataDocument(
      withoutKey(goodDoc, 'client_name'),
      URL_ID,
    ) as { client: { name: string } };
    expect(client.name).toBe('chatgpt.com');
    const long = parseClientMetadataDocument(
      { ...goodDoc, client_name: 'x'.repeat(500) },
      URL_ID,
    ) as { client: { name: string } };
    expect(long.client.name).toHaveLength(100);
  });

  it('rejects something that is not an object', () => {
    expect(parseClientMetadataDocument('nope', URL_ID).ok).toBe(false);
    expect(parseClientMetadataDocument(null, URL_ID).ok).toBe(false);
  });
});

/** A fetch stub that answers every request with `body` and `status`. */
const respond = (body: string, status = 200) =>
  jest.fn<typeof fetch>(async () => new Response(body, { status }));

/** A copy of a document with one key left out, as if the client never sent it. */
function withoutKey(document: Record<string, unknown>, key: string) {
  return Object.fromEntries(
    Object.entries(document).filter(([name]) => name !== key),
  );
}

describe('fetchClientMetadata', () => {
  it('fetches without following redirects and validates the document', async () => {
    const fetchImpl = respond(JSON.stringify(goodDoc));
    const result = await fetchClientMetadata(URL_ID, fetchImpl);
    expect(result.ok).toBe(true);
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0]?.[1] as
      RequestInit | undefined;
    expect(init?.redirect).toBe('manual');
  });

  it('fails on an HTTP error, bad JSON, an oversized body or a network error', async () => {
    const notFound = await fetchClientMetadata(URL_ID, respond('', 404));
    expect(notFound.ok).toBe(false);
    const badJson = await fetchClientMetadata(URL_ID, respond('not json'));
    expect(badJson.ok).toBe(false);
    const oversized = await fetchClientMetadata(
      URL_ID,
      respond(' '.repeat(20_000)),
    );
    expect(oversized.ok).toBe(false);
    const throwing = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const failed = await fetchClientMetadata(URL_ID, throwing);
    expect(failed.ok).toBe(false);
  });

  it('never fetches a client_id that is not a usable URL', async () => {
    const fetchImpl = respond('{}');
    const result = await fetchClientMetadata('http://localhost/x', fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('parseRegistration', () => {
  it('mints a dcr_ client id for a valid request', () => {
    const result = parseRegistration({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/cb'],
    });
    expect(result).toMatchObject({
      ok: true,
      client: { name: 'Claude', kind: 'dcr' },
    });
    expect(
      (result as { client: { clientId: string } }).client.clientId,
    ).toMatch(/^dcr_/);
  });

  it('rejects missing, unsafe or too many redirect URIs', () => {
    for (const redirectUris of [
      undefined,
      [],
      [urls.exampleCallback],
      Array.from({ length: 21 }, (_, i) => `https://a.com/${i}`),
    ]) {
      expect(parseRegistration({ redirect_uris: redirectUris })).toMatchObject({
        ok: false,
        error: 'invalid_redirect_uri',
      });
    }
  });

  it('rejects unsupported grants', () => {
    const base = { redirect_uris: ['https://a.com/cb'] };
    expect(parseRegistration({ ...base, grant_types: ['implicit'] }).ok).toBe(
      false,
    );
  });

  it('rejects a body that is not an object', () => {
    expect(parseRegistration('x').ok).toBe(false);
    expect(parseRegistration(null).ok).toBe(false);
  });
});

describe('parseRegistrationText', () => {
  const text = JSON.stringify({
    client_name: 'Assistant',
    redirect_uris: ['https://app.example/cb'],
  });

  it('registers a valid request', () => {
    expect(parseRegistrationText(text)).toMatchObject({
      ok: true,
      client: { name: 'Assistant', kind: 'dcr' },
    });
  });

  it('refuses a body that is too large before looking at it', () => {
    expect(
      parseRegistrationText('x'.repeat(MAX_REGISTRATION_BYTES + 1)),
    ).toEqual({
      ok: false,
      error: 'invalid_client_metadata',
      description: 'The request is too large.',
    });
  });

  it('refuses text that is not JSON', () => {
    expect(parseRegistrationText('{nope')).toEqual({
      ok: false,
      error: 'invalid_client_metadata',
      description: 'The request is not valid JSON.',
    });
  });

  it('passes on the reasons a client is refused', () => {
    expect(parseRegistrationText('{}')).toMatchObject({
      ok: false,
      error: 'invalid_redirect_uri',
    });
  });
});

describe('registrationResponse', () => {
  it('echoes the client and says how it may be used', () => {
    expect(
      registrationResponse(
        {
          clientId: 'dcr_x',
          name: 'X',
          redirectUris: ['https://app.example/cb'],
          kind: 'dcr',
        },
        1234,
      ),
    ).toEqual({
      client_id: 'dcr_x',
      client_name: 'X',
      redirect_uris: ['https://app.example/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: 1234,
    });
  });
});

describe('client names', () => {
  it('are cleaned of invisible and direction-changing characters', () => {
    const result = parseClientMetadataDocument(
      { ...goodDoc, client_name: '\u202EClaude\u200B  Desktop\n' },
      URL_ID,
    ) as { client: { name: string } };
    expect(result.client.name).toBe('Claude Desktop');
  });

  it('fall back to the host when only invisible characters were given', () => {
    const result = parseClientMetadataDocument(
      { ...goodDoc, client_name: '\u200B\u200B' },
      URL_ID,
    ) as { client: { name: string } };
    expect(result.client.name).toBe('chatgpt.com');
  });

  it('are cleaned for a registered client too, with a neutral fallback', () => {
    const named = parseRegistration({
      client_name: '\u202EEvil\u202C',
      redirect_uris: ['https://a.com/cb'],
    }) as { client: { name: string } };
    expect(named.client.name).toBe('Evil');
    const unnamed = parseRegistration({
      client_name: '\u200B',
      redirect_uris: ['https://a.com/cb'],
    }) as { client: { name: string } };
    expect(unnamed.client.name).toBe('Unnamed client');
  });
});

describe('isMetadataDocumentUrl with a query', () => {
  it('rejects a client_id URL that has a query string', () => {
    expect(isMetadataDocumentUrl('https://a.com/client.json?x=1')).toBe(false);
    expect(isMetadataDocumentUrl('https://a.com/client.json?')).toBe(false);
  });
});

describe('isMetadataDocumentUrl, own site, trailing dot and length', () => {
  it('never takes a document on this very site for a client', () => {
    const own = 'https://site.example';
    expect(
      isMetadataDocumentUrl(
        `${own}/.well-known/oauth-authorization-server`,
        own,
      ),
    ).toBe(false);
    expect(isMetadataDocumentUrl(`${own}/client.json`)).toBe(true);
    expect(isMetadataDocumentUrl(URL_ID, own)).toBe(true);
  });

  it('rejects a host spelled with a trailing dot, which is the same host under a second name', () => {
    expect(isMetadataDocumentUrl('https://chatgpt.com./client.json')).toBe(
      false,
    );
  });

  it('rejects an id longer than 2048 characters', () => {
    const long = `https://a.com/${'x'.repeat(2048)}`;
    expect(isMetadataDocumentUrl(long)).toBe(false);
    expect(isMetadataDocumentUrl(`https://a.com/${'x'.repeat(100)}`)).toBe(
      true,
    );
  });
});

describe('fetchClientMetadata details', () => {
  it('introduces itself with a User-Agent that says whom to ask', async () => {
    const fetchImpl = respond(JSON.stringify(goodDoc));
    await fetchClientMetadata(URL_ID, fetchImpl);
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0]?.[1] as
      RequestInit | undefined;
    expect(init?.headers).toMatchObject({ 'User-Agent': FETCH_USER_AGENT });
    expect(FETCH_USER_AGENT).toMatch(
      new RegExp(String.raw`^${SITE_NAME.toLowerCase()}-oauth/1 \(\+https://`),
    );
  });

  it('does not fetch a document hosted on this very site', async () => {
    const fetchImpl = respond(JSON.stringify(goodDoc));
    const result = await fetchClientMetadata(
      URL_ID,
      fetchImpl,
      'https://chatgpt.com',
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('counts a redirect as a failed fetch: the document must be served at the client_id itself', async () => {
    const redirected = jest.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example/doc' },
        }),
    ) as unknown as typeof fetch;
    expect(await fetchClientMetadata(URL_ID, redirected)).toMatchObject({
      ok: false,
    });
  });

  it('accepts a document with no client_name, using the host as its name', async () => {
    const nameless = Object.fromEntries(
      Object.entries(goodDoc).filter(([key]) => key !== 'client_name'),
    );
    const result = await fetchClientMetadata(
      URL_ID,
      respond(JSON.stringify(nameless)),
    );
    expect(result).toMatchObject({
      ok: true,
      client: { name: 'chatgpt.com' },
    });
  });
});

describe('redirect rules in client metadata', () => {
  it('rejects a document whose redirect URIs include a disallowed scheme', () => {
    for (const uri of [urls.exampleCallback, 'mailto:a@b.c', 'myapp://cb']) {
      expect(
        parseClientMetadataDocument(
          { ...goodDoc, redirect_uris: ['https://chatgpt.com/cb', uri] },
          URL_ID,
        ).ok,
      ).toBe(false);
    }
  });

  it('accepts the redirect URIs of the real clients', () => {
    expect(
      parseClientMetadataDocument(
        {
          ...goodDoc,
          redirect_uris: [
            'https://claude.ai/mcp/auth_callback',
            'cursor://anysphere.cursor-retrieval/oauth/user-x/callback',
            'http://127.0.0.1:33418/',
            'http://localhost:6274/oauth/callback',
          ],
        },
        URL_ID,
      ).ok,
    ).toBe(true);
  });
});

describe('documentTtlSeconds', () => {
  it('uses the default when the server says nothing', () => {
    expect(documentTtlSeconds(null)).toBe(DEFAULT_DOCUMENT_TTL_SECONDS);
    expect(documentTtlSeconds('public')).toBe(DEFAULT_DOCUMENT_TTL_SECONDS);
  });

  it('follows max-age', () => {
    expect(documentTtlSeconds('public, max-age=7200')).toBe(7200);
  });

  it('keeps max-age between five minutes and a day', () => {
    expect(documentTtlSeconds('max-age=5')).toBe(MIN_DOCUMENT_TTL_SECONDS);
    expect(documentTtlSeconds('max-age=999999999')).toBe(
      MAX_DOCUMENT_TTL_SECONDS,
    );
  });

  it('keeps a document only briefly when told not to cache it', () => {
    expect(documentTtlSeconds('no-store')).toBe(MIN_DOCUMENT_TTL_SECONDS);
    expect(documentTtlSeconds('No-Cache, max-age=86400')).toBe(
      MIN_DOCUMENT_TTL_SECONDS,
    );
  });
});

describe('readCappedText', () => {
  const streamOf = (...parts: readonly string[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          parts.forEach((part) =>
            controller.enqueue(new TextEncoder().encode(part)),
          );
          controller.close();
        },
      }),
    );

  it('reads a body under the cap, across chunks', async () => {
    expect(await readCappedText(streamOf('{"a":', '1}'), 100)).toBe('{"a":1}');
  });

  it('decodes a character split between two chunks', async () => {
    const bytes = new TextEncoder().encode('é');
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 1));
          controller.enqueue(bytes.slice(1));
          controller.close();
        },
      }),
    );
    expect(await readCappedText(response, 100)).toBe('é');
  });

  it('gives up as soon as the body passes the cap, without reading the rest', async () => {
    let pulled = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(40));
        },
      }),
    );
    expect(await readCappedText(response, 100)).toBeUndefined();
    expect(pulled).toBeLessThan(10);
  });

  it('refuses a declared Content-Length over the cap without reading', async () => {
    let pulled = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(1));
        },
      }),
      { headers: { 'content-length': '5000' } },
    );
    expect(await readCappedText(response, 100)).toBeUndefined();
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('reads an empty response as empty text', async () => {
    expect(await readCappedText(new Response(null), 100)).toBe('');
  });
});

describe('fetchClientMetadata streaming and caching', () => {
  const serve = (init: ResponseInit, body: string = JSON.stringify(goodDoc)) =>
    jest.fn(async () => new Response(body, init)) as unknown as typeof fetch;

  it('reports how long the document may be cached', async () => {
    const result = await fetchClientMetadata(
      URL_ID,
      serve({ headers: { 'cache-control': 'max-age=1800' } }),
    );
    expect(result).toMatchObject({ ok: true, ttlSeconds: 1800 });
  });

  it('uses the default lifetime without cache headers', async () => {
    expect(await fetchClientMetadata(URL_ID, serve({}))).toMatchObject({
      ok: true,
      ttlSeconds: DEFAULT_DOCUMENT_TTL_SECONDS,
    });
  });

  it('refuses a document over the byte cap', async () => {
    const big = JSON.stringify({
      ...goodDoc,
      client_name: 'x'.repeat(MAX_DOCUMENT_BYTES),
    });
    const result = await fetchClientMetadata(URL_ID, serve({}, big));
    expect(result.ok).toBe(false);
  });

  it('refuses a document whose Content-Length is over the cap', async () => {
    const result = await fetchClientMetadata(
      URL_ID,
      serve({ headers: { 'content-length': String(MAX_DOCUMENT_BYTES + 1) } }),
    );
    expect(result).toMatchObject({ ok: false, error: 'invalid_client' });
  });

  it('fails when reading the body fails', async () => {
    const broken = jest.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error('reset'));
            },
          }),
        ),
    ) as unknown as typeof fetch;
    const failed = await fetchClientMetadata(URL_ID, broken);
    expect(failed.ok).toBe(false);
  });
});

describe('cached document freshness', () => {
  const NOW = Date.parse('2026-06-01T12:00:00.000Z');
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
  const ahead = (seconds: number) =>
    new Date(NOW + seconds * 1000).toISOString();

  it('is fresh until the recorded expiry', () => {
    expect(
      isDocumentFresh({ fetchedAt: ago(60), expiresAt: ahead(60) }, NOW),
    ).toBe(true);
    expect(
      isDocumentFresh({ fetchedAt: ago(7200), expiresAt: ago(1) }, NOW),
    ).toBe(false);
  });

  it('falls back to the default lifetime for a copy with no recorded expiry', () => {
    expect(isDocumentFresh({ fetchedAt: ago(60), expiresAt: null }, NOW)).toBe(
      true,
    );
    expect(
      isDocumentFresh(
        { fetchedAt: ago(DEFAULT_DOCUMENT_TTL_SECONDS + 1), expiresAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it('is never fresh for a client that was not fetched', () => {
    expect(isDocumentFresh({ fetchedAt: null, expiresAt: null }, NOW)).toBe(
      false,
    );
  });

  it('may be used as a fallback for up to a week, then not', () => {
    expect(
      isDocumentUsable(
        { fetchedAt: ago(MAX_STALE_DOCUMENT_SECONDS - 60), expiresAt: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      isDocumentUsable(
        { fetchedAt: ago(MAX_STALE_DOCUMENT_SECONDS + 60), expiresAt: null },
        NOW,
      ),
    ).toBe(false);
    expect(isDocumentUsable({ fetchedAt: null, expiresAt: null }, NOW)).toBe(
      false,
    );
  });
});

describe('isClientBusy', () => {
  it('recognises the busy answer and nothing else', () => {
    expect(isClientBusy({ busy: true, retryAfterSeconds: 3 })).toBe(true);
    expect(isClientBusy(undefined)).toBe(false);
    expect(
      isClientBusy({
        clientId: 'a',
        name: 'A',
        redirectUris: [],
        kind: 'dcr',
      }),
    ).toBe(false);
  });
});

describe('parseRegistration token_endpoint_auth_method (RFC 7591)', () => {
  const base = { redirect_uris: ['https://a.com/cb'] };

  it('accepts "none" explicitly and registers a public client', () => {
    const result = parseRegistration({
      ...base,
      token_endpoint_auth_method: 'none',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a request that does not say', () => {
    expect(parseRegistration(base).ok).toBe(true);
  });

  it.each(['client_secret_basic', 'client_secret_post', 'private_key_jwt'])(
    'registers a client that asks for %s as the public client it will be (RFC 7591 3.2.1)',
    (method) => {
      expect(
        parseRegistration({ ...base, token_endpoint_auth_method: method }),
      ).toMatchObject({ ok: true, client: { kind: 'dcr' } });
    },
  );

  it('refuses an auth method that is not text', () => {
    expect(
      parseRegistration({ ...base, token_endpoint_auth_method: 7 }),
    ).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
  });

  it('answers with what was registered, whatever the request asked for', () => {
    const result = parseRegistration({
      ...base,
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'client_credentials'],
    });
    expect(result.ok && registrationResponse(result.client, 1)).toMatchObject({
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  it('accepts grant types that include authorization_code and rejects those that do not', () => {
    expect(
      parseRegistration({
        ...base,
        grant_types: ['authorization_code', 'refresh_token'],
      }).ok,
    ).toBe(true);
    expect(
      parseRegistration({ ...base, grant_types: ['client_credentials'] }),
    ).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(parseRegistration({ ...base, grant_types: [] }).ok).toBe(false);
    expect(parseRegistration({ ...base, grant_types: 'code' }).ok).toBe(false);
  });

  it('accepts response_types that include "code" and rejects those that do not', () => {
    expect(parseRegistration({ ...base, response_types: ['code'] }).ok).toBe(
      true,
    );
    expect(
      parseRegistration({ ...base, response_types: ['code', 'token'] }).ok,
    ).toBe(true);
    expect(
      parseRegistration({ ...base, response_types: ['token'] }),
    ).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(parseRegistration({ ...base, response_types: [] }).ok).toBe(false);
    expect(parseRegistration({ ...base, response_types: 'code' }).ok).toBe(
      false,
    );
  });
});

describe('error_description is printable ASCII without quotes or backslashes (RFC 6749 5.2, RFC 7591 3.2.2)', () => {
  const allowed = /^[\u0020\u0021\u0023-\u005B\u005D-\u007E]+$/;
  const base = { redirect_uris: ['https://a.com/cb'] };

  it.each([
    ['a body that is not an object', 'x'],
    ['no redirect_uris', {}],
    [
      'redirect_uris that are not acceptable',
      { redirect_uris: [urls.ftpRedirect] },
    ],
    ['a non-text auth method', { ...base, token_endpoint_auth_method: 7 }],
    ['grant types without authorization_code', { ...base, grant_types: ['x'] }],
    ['response types without code', { ...base, response_types: ['token'] }],
  ])('for a registration with %s', (_name, body) => {
    const result = parseRegistration(body);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.description).toMatch(allowed);
  });

  it.each([
    ['not an object', 'x'],
    ['another client_id', { ...goodDoc, client_id: 'https://other.example/x' }],
    ['no redirect_uris', { ...goodDoc, redirect_uris: [] }],
    [
      'a shared-secret method',
      { ...goodDoc, token_endpoint_auth_method: 'client_secret_basic' },
    ],
  ])('for a client metadata document that is %s', (_name, document) => {
    const result = parseClientMetadataDocument(document, URL_ID);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.description).toMatch(allowed);
  });

  it('for a registration request that is too large or not JSON', () => {
    for (const text of ['x'.repeat(MAX_REGISTRATION_BYTES + 1), 'nope']) {
      const result = parseRegistrationText(text);
      expect(!result.ok && result.description).toMatch(allowed);
    }
  });
});
