import { getEnv } from './runtime';

/**
 * The app's public origin: the `APP_URL` secret when set, otherwise the origin
 * of the incoming request (so localhost and the custom domain both work with
 * no configuration).
 */
export function appOrigin(request: Request): string {
  return configuredOrigin() ?? new URL(request.url).origin;
}

/**
 * The origin in an `APP_URL` setting: `https://host`, whatever else the value
 * carries (a trailing slash or a path would otherwise end up in every absolute
 * URL built from it). `undefined` for nothing, or for a value that is not an
 * http(s) URL, which is ignored rather than trusted.
 */
export function originOfSetting(
  setting: string | undefined,
): string | undefined {
  if (!setting) {
    return undefined;
  }
  try {
    const url = new URL(setting.trim());
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `APP_URL` setting as an origin, or `undefined` when it is not set or there is no Cloudflare context (tests, scripts). */
function configuredOrigin(): string | undefined {
  try {
    return originOfSetting(getEnv().APP_URL);
  } catch {
    return undefined;
  }
}

/**
 * Like {@link appOrigin}, for Server Components, which get request headers
 * rather than a `Request`. The host is the request's own `Host` header, which
 * Cloudflare sets to the address the browser used; `x-forwarded-host` is
 * deliberately NOT read, because anyone can send it and the answer is shown to
 * people as "the address to add to your assistant". The scheme comes from
 * `x-forwarded-proto` only when it says `http` or `https`.
 * @public
 */
export function appOriginFromHeaders(headers: Headers): string {
  const configured = configuredOrigin();
  if (configured) {
    return configured;
  }
  const host = headers.get('host') ?? 'localhost';
  const forwarded = headers.get('x-forwarded-proto');
  const proto =
    forwarded === 'http' || forwarded === 'https'
      ? forwarded
      : host.startsWith('localhost') || host.startsWith('127.')
        ? 'http'
        : 'https';
  return `${proto}://${host}`;
}
