import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://broadsheet.apps.mrida.ng)';

/**
 * Lazy image proxy: re-serves a remote image from our own origin so that
 * Cloudflare Image Transformations (which only allow same-zone sources by
 * default) can resize/reformat it — no "allow any origin" toggle needed.
 * Only streams responses that are actually images. The edge caches the result.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const u = request.nextUrl.searchParams.get('u');
  if (!u || !/^https?:\/\//i.test(u)) {
    return new Response('bad url', { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(u, {
      headers: { 'user-agent': UA, accept: 'image/*,*/*' },
      redirect: 'follow',
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !type.startsWith('image/')) {
    return new Response('not an image', { status: 404 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': type,
      // Cache the proxied original; the transformed variants are cached by the
      // /cdn-cgi/image layer in front of this route.
      'cache-control': 'public, max-age=86400',
    },
  });
}
