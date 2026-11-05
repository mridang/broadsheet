import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // (The stylesheet is deliberately NOT inlined into the page. An inline
  // <style> carries no nonce, so the Content Security Policy would refuse it
  // and the page would show unstyled; a linked stylesheet from this site is
  // allowed.)
  // Nor does Next keep pages in its own client cache (`staleTimes`): a link
  // fetches its page from the server every time, so a page is never older than
  // the click that opened it. (The back and forward buttons still restore what
  // was on screen, which Next does regardless.)
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
};

/**
 * The Cloudflare bindings are only emulated for `next dev`. A production build
 * must not try: a remote-only binding needs Cloudflare credentials to start,
 * and a build has no use for them.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    void initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
