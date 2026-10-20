import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // No need to tell the world which framework is serving the site.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The approval screen must never be framed (clickjacking would let a
        // hostile page trick someone into approving an app) or cached. (Its
        // Content-Security-Policy, which also forbids framing, comes from the
        // Worker with the rest of the site's.)
        source: '/oauth/authorize',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
  experimental: {
    // (The stylesheet is deliberately NOT inlined into the page. An inline
    // <style> carries no nonce, so the Content Security Policy would refuse it
    // and the page would show unstyled; a linked stylesheet from this site is
    // allowed.)
    // Keep prefetched pages in the browser's client cache for three minutes, so a
    // card that has already been prefetched opens instantly with no server
    // request. Short, because recipe pages are personal (favourites, notes) and
    // router.refresh() after a change invalidates the cache anyway.
    staleTimes: { dynamic: 180, static: 180 },
  },
};

/**
 * The Cloudflare bindings (D1, AI, Images) are only emulated for `next dev`. A
 * production build must not try: the AI binding is remote-only, so starting the
 * emulation needs Cloudflare credentials, and a build has no use for them.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    void initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
