/** Worker bindings. Secrets are injected at runtime via `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  /** Origin used for OAuth redirects + absolute links, e.g. https://broadsheet.apps.mrida.ng */
  BASE_URL?: string;
  /** HMAC key for signed session cookies. */
  SESSION_SECRET?: string;
  /** Google OAuth client; when unset, dev-login is enabled instead. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Optional: enables LLM-resolved source names. Falls back to a deterministic algorithm. */
  ANTHROPIC_API_KEY?: string;
  /** Force-enable the passwordless dev login ("1"); otherwise it's on only when OAuth is unconfigured. */
  ALLOW_DEV_LOGIN?: string;
}

export interface User {
  id: number;
  sub: string;
  email: string;
  name: string;
  picture: string;
  created_at: string;
}

export interface Feed {
  id: number;
  user_id: number;
  url: string;
  title: string;
  created_at: string;
}

export interface Article {
  id: number;
  feed_id: number;
  url: string;
  title: string;
  source: string;
  image: string;
  favicon: string;
  summary: string;
  published_at: string;
  fetched_at: string;
}

/** A scraped item before it's persisted. */
export interface ScrapedItem {
  url: string;
  title: string;
  source: string;
  image: string;
  favicon: string;
  summary: string;
  published_at: string;
}

export interface OAuthProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}
