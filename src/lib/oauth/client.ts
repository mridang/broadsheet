/**
 * @packageDocumentation
 *
 * OAuth clients: the assistants that ask a user for access. A client is known
 * in one of two ways:
 *
 *  - **Client ID Metadata Document** (preferred by the MCP spec): the
 *    `client_id` is an HTTPS URL, and the JSON at that URL describes the client.
 *    Nothing to register; we fetch and validate it.
 *  - **Dynamic registration** (RFC 7591, deprecated but still common): the
 *    client posts its details to `/oauth/register` and gets an id back.
 *
 * Only public clients (no client secret, PKCE required) are supported.
 */

import { sanitiseDisplayName } from '@/lib/oauth/display';
import { isAcceptableRedirectUri } from '@/lib/oauth/redirect-uri';
import { isPublicWebUrl } from '@/lib/safe-fetch';
import { bytesToBase64Url } from '@/utils/base64';
import { SITE_NAME, SITE_URL } from '@/utils/site';
import { parseUrl } from '@/utils/url';

/** A client as the authorization server uses it. */
export interface OAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  /** How the client became known: `dcr` registered itself, `cimd` published a metadata document. */
  readonly kind: 'dcr' | 'cimd';
  /** How the client proves itself at the token endpoint; absent means a public client (PKCE only). */
  readonly auth?: ClientAuth;
  /** The https address of the picture the client's metadata document names, if it names a usable one. */
  readonly logoUri?: string;
}

/** The signature algorithms accepted on a client assertion. `none` and the HMAC family are never among them. */
export const ASSERTION_ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;

/** A client that signs an assertion (RFC 7523) with a key it publishes at `jwksUri`. */
export interface ClientAuth {
  readonly method: 'private_key_jwt';
  readonly jwksUri: string;
}

/**
 * Largest metadata document we will read, in bytes (CIMD draft §6.6 asks
 * implementations to limit the size and suggests 5 KB). We allow twice that: a
 * document may list twenty redirect addresses of a couple of hundred characters
 * each, and a client that legitimately needs more than the suggestion would
 * otherwise simply not connect. The cap is enforced while streaming, so the
 * larger figure costs nothing.
 */
export const MAX_DOCUMENT_BYTES = 10_000;

/**
 * The longest `client_id` we look up or accept as a metadata-document address.
 * The id is a database key and a rate-limit subject; nothing legitimate needs
 * more.
 */
export const MAX_CLIENT_ID_LENGTH = 2048;

/**
 * How we introduce ourselves when fetching a client's document, so its host can
 * recognise and allow-list us and knows whom to ask about the traffic.
 */
export const FETCH_USER_AGENT = `${SITE_NAME.toLowerCase()}-oauth/1 (+${SITE_URL})`;

/** How long to wait for a client's metadata document. */
const FETCH_TIMEOUT_MS = 5000;

/** How long a fetched document is trusted when the server says nothing about caching (one hour). */
export const DEFAULT_DOCUMENT_TTL_SECONDS = 60 * 60;

/** The shortest time a fetched document is kept, however short-lived the server says it is (five minutes). */
export const MIN_DOCUMENT_TTL_SECONDS = 5 * 60;

/** The longest time a fetched document is kept, however long-lived the server says it is (one day). */
export const MAX_DOCUMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Whether a `client_id` is a metadata-document URL rather than a plain id.
 * `ownOrigin`, when given, is this server's own origin: a document "hosted" by
 * ourselves would make every lookup a request to ourselves, so it is never a
 * client.
 */
export function isMetadataDocumentUrl(
  clientId: string,
  ownOrigin?: string,
): boolean {
  const url =
    clientId.length <= MAX_CLIENT_ID_LENGTH ? parseUrl(clientId) : undefined;
  if (url === undefined) {
    return false;
  }
  return [
    url.origin !== ownOrigin,
    url.protocol === 'https:',
    url.pathname.length > 1,
    // CIMD draft §3: the URL SHOULD NOT have a query string.
    !url.href.includes('?'),
    !url.hash,
    !url.username,
    !url.password,
    url.hostname.includes('.'),
    // `example.com.` and `example.com` are one host with two spellings; only
    // the plain one may name a client.
    !url.hostname.endsWith('.'),
    // A bare IP address is never a client's public home.
    !/^[\d.]+$/.test(url.hostname),
    !url.hostname.startsWith('['),
    // Dot segments, an upper-case host or a default port would make the URL
    // we fetch differ from the client_id the client presented.
    url.href === clientId,
  ].every(Boolean);
}

/**
 * A client's display name, cleaned for showing to a person (see
 * {@link sanitiseDisplayName}): invisible and direction-changing characters
 * removed, whitespace collapsed, capped, and `fallback` when nothing is left.
 */
function cleanName(name: unknown, fallback: string): string {
  return sanitiseDisplayName(name, fallback);
}

/**
 * The picture a metadata document names for its client: its `logo_uri` when that
 * is a plain https address of a public site, and nothing otherwise. It is only
 * ever fetched through the image proxy, which checks it again.
 */
function logoOf(value: unknown): string | undefined {
  const url =
    typeof value === 'string' && value.length <= MAX_CLIENT_ID_LENGTH
      ? parseUrl(value)
      : undefined;
  if (url === undefined || url.href !== value || !isPublicWebUrl(url.href)) {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hash || url.username || url.password) {
    return undefined;
  }
  return url.href;
}

/** Whether a value is a JSON object (or array) whose members can be looked up by name. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Whether every member of a list is a redirect address we would accept. */
function isRedirectList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every((u) => typeof u === 'string' && isAcceptableRedirectUri(u))
  );
}

/** The redirect addresses to use: 1 to 20 acceptable ones, or undefined. */
function redirectList(value: unknown): readonly string[] | undefined {
  return isRedirectList(value) ? value : undefined;
}

/**
 * What looking a client up can answer besides "here it is" and "unknown": "ask
 * again later". The lookup would have meant fetching the client's metadata
 * document, and too many fetches have happened lately (see `limits.ts`).
 */
export interface ClientBusy {
  readonly busy: true;
  /** Seconds to wait before asking again. */
  readonly retryAfterSeconds: number;
}

/** Whether a client lookup answered "ask again later". */
export function isClientBusy(
  lookup: OAuthClient | ClientBusy | undefined,
): lookup is ClientBusy {
  return lookup !== undefined && 'busy' in lookup;
}

/** How long a cached copy of a metadata document may still be used when a fresh one cannot be fetched (seven days). */
export const MAX_STALE_DOCUMENT_SECONDS = 7 * 24 * 60 * 60;

/** The timestamps that say how current a cached metadata document is. */
export interface CachedDocument {
  /** When it was fetched (ISO-8601), or null if the client was not fetched. */
  readonly fetchedAt: string | null;
  /** Until when it may be reused (ISO-8601); null for copies stored before expiry was recorded. */
  readonly expiresAt: string | null;
}

/** Whether a cached document may be used as it is, without fetching it again, at `nowMs` (milliseconds). */
export function isDocumentFresh(
  cached: Readonly<CachedDocument>,
  nowMs: number,
): boolean {
  if (cached.fetchedAt === null) {
    return false;
  }
  const until = cached.expiresAt
    ? Date.parse(cached.expiresAt)
    : Date.parse(cached.fetchedAt) + DEFAULT_DOCUMENT_TTL_SECONDS * 1000;
  return nowMs < until;
}

/**
 * Whether a cached document is recent enough to fall back on when fetching a
 * new one fails. Past {@link MAX_STALE_DOCUMENT_SECONDS} the client is treated
 * as unknown rather than trusted on very old data (CIMD draft §4.3: abort when
 * discovery fails).
 */
export function isDocumentUsable(
  cached: Readonly<CachedDocument>,
  nowMs: number,
): boolean {
  return (
    cached.fetchedAt !== null &&
    nowMs - Date.parse(cached.fetchedAt) < MAX_STALE_DOCUMENT_SECONDS * 1000
  );
}

/**
 * How a metadata document says its client authenticates: not at all (a public
 * client, the default), or by `private_key_jwt` with a `jwks_uri` over https
 * and a signing algorithm we accept. A preference is honoured as declared and
 * never downgraded, so a client that names `private_key_jwt` always has to sign;
 * any other method (a shared secret) is not supported.
 */
function documentAuth(
  doc: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly auth?: ClientAuth }
  | { readonly ok: false; readonly description: string } {
  const method = doc['token_endpoint_auth_method'];
  if (method === undefined || method === 'none') {
    return { ok: true };
  }
  if (method !== 'private_key_jwt') {
    return {
      ok: false,
      description:
        'Only token_endpoint_auth_method none and private_key_jwt are supported.',
    };
  }
  const jwksUri = doc['jwks_uri'];
  const jwks = typeof jwksUri === 'string' ? parseUrl(jwksUri) : undefined;
  if (
    typeof jwksUri !== 'string' ||
    jwksUri.length > MAX_CLIENT_ID_LENGTH ||
    !jwks ||
    [
      jwks.protocol !== 'https:',
      jwks.hash,
      jwks.username,
      jwks.password,
      !jwks.hostname.includes('.'),
      jwks.href !== jwksUri,
    ].some(Boolean)
  ) {
    return {
      ok: false,
      description: 'A private_key_jwt client needs an https jwks_uri.',
    };
  }
  const alg = doc['token_endpoint_auth_signing_alg'];
  if (
    alg !== undefined &&
    !(
      typeof alg === 'string' &&
      (ASSERTION_ALGORITHMS as readonly string[]).includes(alg)
    )
  ) {
    return {
      ok: false,
      description: `token_endpoint_auth_signing_alg must be one of ${ASSERTION_ALGORITHMS.join(', ')}.`,
    };
  }
  return {
    ok: true,
    auth: { method: 'private_key_jwt', jwksUri },
  };
}

/** The result of validating client metadata. */
export type ClientParse =
  | { readonly ok: true; readonly client: OAuthClient }
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
    };

/** The refusal every failed metadata check returns: `invalid_client` with the reason. */
function invalidClient(
  description: string,
): Extract<ClientParse, { readonly ok: false }> {
  return { ok: false, error: 'invalid_client', description };
}

/**
 * Validate a fetched Client ID Metadata Document. The `client_id` inside must
 * equal the URL it was fetched from, or anyone could claim to be anyone.
 */
export function parseClientMetadataDocument(
  document: unknown,
  url: string,
): ClientParse {
  const bad = invalidClient;
  if (!isRecord(document)) {
    return bad('The client metadata document is not a JSON object.');
  }
  const doc = document;
  if (doc['client_id'] !== url) {
    return bad('The document client_id does not match the URL it came from.');
  }
  const redirectUris = redirectList(doc['redirect_uris']);
  if (!redirectUris) {
    return bad('The document has no valid redirect_uris.');
  }
  const auth = documentAuth(doc);
  if (!auth.ok) {
    return bad(auth.description);
  }
  const logoUri = logoOf(doc['logo_uri']);
  // `client_name` is among the properties the CIMD draft lists, but a document
  // without one is still unambiguous (the approval screen leads with the domain
  // that published it), so the host stands in for it rather than turning the
  // client away.
  return {
    ok: true,
    client: {
      clientId: url,
      name: cleanName(doc['client_name'], new URL(url).hostname),
      redirectUris,
      kind: 'cimd',
      ...(auth.auth && { auth: auth.auth }),
      ...(logoUri && { logoUri }),
    },
  };
}

/** A fetched and validated metadata document, with how long it may be kept. */
export type ClientFetch =
  | {
      readonly ok: true;
      readonly client: OAuthClient;
      /** How long the document may be reused before fetching it again, in seconds. */
      readonly ttlSeconds: number;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
    };

/**
 * How long a fetched document may be reused, from its `Cache-Control` header:
 * `max-age`, kept within five minutes and a day. Without the header, or with
 * `no-store`/`no-cache`, the shortest time applies (the document is still needed
 * for the few minutes a sign-in takes, so it is never dropped at once).
 */
export function documentTtlSeconds(cacheControl: string | null): number {
  if (cacheControl === null) {
    return DEFAULT_DOCUMENT_TTL_SECONDS;
  }
  const directives = cacheControl
    .toLowerCase()
    .split(',')
    .map((directive) => directive.trim());
  if (directives.some((d) => d === 'no-store' || d === 'no-cache')) {
    return MIN_DOCUMENT_TTL_SECONDS;
  }
  const maxAge = directives
    .map((d) => /^max-age=(\d+)$/.exec(d)?.[1])
    .find((value) => value !== undefined);
  return maxAge === undefined
    ? DEFAULT_DOCUMENT_TTL_SECONDS
    : Math.min(
        MAX_DOCUMENT_TTL_SECONDS,
        Math.max(MIN_DOCUMENT_TTL_SECONDS, Number(maxAge)),
      );
}

/** Read chunks until the stream ends, or give up (undefined) once more than `remaining` bytes have arrived. */
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  remaining: number,
  chunks: readonly Uint8Array[] = [],
): Promise<readonly Uint8Array[] | undefined> {
  const { done, value } = await reader.read();
  if (done) {
    return chunks;
  }
  if (value.byteLength > remaining) {
    await reader.cancel();
    return undefined;
  }
  return drain(reader, remaining - value.byteLength, [...chunks, value]);
}

/**
 * The body of a response as text, read as a stream so that a hostile server
 * can never make us hold more than `maxBytes`: a declared `Content-Length`
 * over the cap is refused before reading, and an undeclared (or lying) body is
 * cut off the moment it passes the cap. Undefined means "too large".
 */
export async function readCappedText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.body) {
    return '';
  }
  const chunks = await drain(response.body.getReader(), maxBytes);
  // One decoder carried across the chunks, so a character split between two of
  // them still decodes; only the last chunk flushes it.
  const decoder = new TextDecoder();
  return chunks
    ?.map((chunk, at) =>
      decoder.decode(chunk, { stream: at < chunks.length - 1 }),
    )
    .join('');
}

/**
 * Fetch and validate a client's metadata document. Never follows redirects, caps
 * the size (streamed, so a huge body is never buffered) and time, and (on
 * Workers) can only reach public hosts, so a hostile `client_id` can't be used
 * to probe internal services. The result says how long the document may be
 * reused, from its cache headers.
 */
export async function fetchClientMetadata(
  url: string,
  fetchImpl: typeof fetch = fetch,
  ownOrigin?: string,
): Promise<ClientFetch> {
  const bad = invalidClient;
  if (!isMetadataDocumentUrl(url, ownOrigin)) {
    return bad('The client_id is not a usable metadata document URL.');
  }
  // Redirects are not followed: the document must be served at the `client_id`
  // itself (a 3xx counts as a failed fetch), so the address we fetched is the
  // address the client claims.
  const response = await fetchImpl(url, {
    redirect: 'manual',
    headers: { Accept: 'application/json', 'User-Agent': FETCH_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => undefined);
  if (!response) {
    return bad('The client metadata document could not be fetched.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    return bad(
      `The client metadata document returned HTTP ${response.status}.`,
    );
  }
  const text = await readCappedText(response, MAX_DOCUMENT_BYTES).catch(
    () => undefined,
  );
  if (text === undefined) {
    return bad('The client metadata document is too large or unreadable.');
  }
  const json = parseJson(text);
  const parsed = json.ok
    ? parseClientMetadataDocument(json.value, url)
    : bad('The client metadata document is not valid JSON.');
  return parsed.ok
    ? {
        ok: true,
        client: parsed.client,
        ttlSeconds: documentTtlSeconds(response.headers.get('cache-control')),
      }
    : parsed;
}

/** JSON text parsed without throwing: the value, or a note that it wasn't JSON. */
function parseJson(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** The outcome of a dynamic registration request. */
export type Registration =
  | { readonly ok: true; readonly client: OAuthClient }
  | {
      readonly ok: false;
      readonly error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      readonly description: string;
    };

/** Registration bodies are tiny; anything bigger is refused unread. */
export const MAX_REGISTRATION_BYTES = 8000;

/** Read the text of an RFC 7591 registration request: size, then JSON, then the rules of {@link parseRegistration}. */
export function parseRegistrationText(text: string): Registration {
  if (text.length > MAX_REGISTRATION_BYTES) {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description: 'The request is too large.',
    };
  }
  const body = parseJson(text);
  return body.ok
    ? parseRegistration(body.value)
    : {
        ok: false,
        error: 'invalid_client_metadata',
        description: 'The request is not valid JSON.',
      };
}

/** The RFC 7591 answer for a client that has just registered (`issuedAt` in Unix seconds). */
export function registrationResponse(
  client: Readonly<OAuthClient>,
  issuedAt: number,
): Readonly<Record<string, unknown>> {
  return {
    client_id: client.clientId,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_id_issued_at: issuedAt,
  };
}

/** A registration refused because of its metadata (as opposed to its redirect addresses). */
function invalidMetadata(description: string): Registration {
  return { ok: false, error: 'invalid_client_metadata', description };
}

/**
 * Validate an RFC 7591 registration request and mint a client id. Every client
 * registered here is a public client using the authorization-code grant with
 * refresh tokens; requests for more (a secret, other grants) are answered with
 * what was registered instead of being refused.
 */
export function parseRegistration(body: unknown): Registration {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description: 'The request body must be a JSON object.',
    };
  }
  const data = body;
  const redirectUris = redirectList(data['redirect_uris']);
  if (!redirectUris) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description:
        'redirect_uris must list 1 to 20 https URIs, loopback http URIs (localhost, 127.0.0.1 or [::1]) or reverse-domain app-scheme URIs.',
    };
  }
  // RFC 7591 §3.2.1 lets the server replace metadata it does not support
  // rather than refuse the client, and the answer (`registrationResponse`)
  // states what was registered. Generic client libraries ask for things like a
  // client secret by default; they work fine as the public client they will be.
  const method = data['token_endpoint_auth_method'];
  if (method !== undefined && typeof method !== 'string') {
    return invalidMetadata('token_endpoint_auth_method must be a string.');
  }
  const grants = data['grant_types'];
  if (
    grants !== undefined &&
    !(Array.isArray(grants) && grants.includes('authorization_code'))
  ) {
    return invalidMetadata(
      'grant_types must include authorization_code, the grant this server offers.',
    );
  }
  const responseTypes = data['response_types'];
  if (
    responseTypes !== undefined &&
    !(Array.isArray(responseTypes) && responseTypes.includes('code'))
  ) {
    return invalidMetadata('response_types must include code.');
  }
  const id = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  return {
    ok: true,
    client: {
      clientId: `dcr_${id}`,
      name: cleanName(data['client_name'], 'Unnamed client'),
      redirectUris,
      kind: 'dcr',
    },
  };
}
