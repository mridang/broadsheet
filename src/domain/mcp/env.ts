/**
 * @packageDocumentation
 *
 * Reading optional settings from the Cloudflare environment without assuming
 * there is one (tests and scripts run without it).
 *
 * The one setting the MCP endpoint reads is `MCP_ALLOWED_ORIGINS`, a
 * comma-separated list of extra browser origins that may call it, written as the
 * browser sends them (`https://tool.example`, `https://tool.example:8080`,
 * `chrome-extension://abcdef`, `vscode-webview://abc`, `tauri://localhost`).
 * Origins that web clients use (our own, the assistants', localhost) are
 * already allowed; this is for a browser extension, an Electron or webview app
 * or a self-hosted tool. Entries are matched exactly (the port counts, a
 * trailing slash does not match), and `*` and `null` are ignored on purpose.
 * Set it as a Worker variable or secret, for example
 * `MCP_ALLOWED_ORIGINS="chrome-extension://abcdef,https://tool.example"`.
 */

import { getEnv } from '@/lib/core/runtime';

/** The name of the setting that adds browser origins allowed to call the MCP endpoint. */
export const ALLOWED_ORIGINS_SETTING = 'MCP_ALLOWED_ORIGINS';

/** A setting from the environment, or undefined when there is none (or no context). */
export function getEnvSafe(name: string): string | undefined {
  try {
    const value: unknown = Reflect.get(getEnv(), name);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
