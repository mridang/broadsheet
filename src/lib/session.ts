/**
 * @packageDocumentation
 *
 * Signed-cookie sessions + cookie helpers. Uses Web Crypto (crypto.subtle)
 * HMAC — what the Workers runtime provides — to sign and constant-time
 * verify a value (the user id) carried in an HTTP-only cookie.
 */

const enc = new TextEncoder();

function b64urlEncode(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(
    padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='),
  );
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const k = crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  keyCache.set(secret, k);
  return k;
}

/** Append an HMAC tag: `value.tag`. @public */
export async function sign(secret: string, value: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    enc.encode(value),
  );
  return `${value}.${b64urlEncode(sig)}`;
}

/** Verify `value.tag` (constant-time via crypto.subtle.verify); return value or null. @public */
export async function unsign(
  secret: string,
  signed: string,
): Promise<string | null> {
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(signed.slice(i + 1)),
      enc.encode(value),
    );
    return ok ? value : null;
  } catch {
    return null;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export interface CookieOpts {
  maxAge?: number;
  secure?: boolean;
}

export function cookie(
  name: string,
  value: string,
  opts: CookieOpts = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
