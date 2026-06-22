import { getCloudflareContext } from '@opennextjs/cloudflare';

/** The D1 database binding from the current Cloudflare context. */
export function getDB(): D1Database {
  return getCloudflareContext().env.DB;
}

/** The full Cloudflare environment from the current context. */
export function getEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}
