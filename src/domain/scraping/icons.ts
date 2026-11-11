/**
 * @packageDocumentation
 *
 * Finding the icon a feed's site really uses. Every icon the site and the
 * feed declare is a candidate: the site's `<link rel="icon">` and
 * `apple-touch-icon` (largest first), its web app manifest's icons, the feed's
 * own `<image>`, `<icon>` or `<logo>`, then `/favicon.ico`. Each is fetched
 * and the first that answers with an image is kept, so the page never shows a
 * broken one; pages show it through our own `/img` proxy.
 */

/** An icon a page or manifest declares, with the size it says it is. */
interface Declared {
  readonly href: string;
  readonly size: number;
}

/** The longest side a `sizes` value names (`32x32 192x192` → 192; `any` → 512). */
function largest(sizes: string): number {
  if (/\bany\b/i.test(sizes)) return 512;
  return Math.max(
    0,
    // eslint-disable-next-line sonarjs/super-linear-regex -- the sizes attribute is short, so the digit runs cannot backtrack far
    ...[...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) =>
      Math.max(Number(m[1]), Number(m[2])),
    ),
  );
}

/** An address made absolute against `base`, or undefined when it is not one. */
function absolute(href: string, base: string): string | undefined {
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** One attribute of a tag, or blank. */
function attribute(tag: string, name: string): string {
  const pattern = new RegExp(String.raw`\b${name}\s*=\s*["']([^"']*)["']`, 'i');
  return pattern.exec(tag)?.[1] ?? '';
}

/** The icons a page's `<link>` tags declare, largest first. */
export function pageIcons(html: string, base: string): string[] {
  const found: Declared[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, 'rel').toLowerCase().split(/\s+/);
    const isIcon = rel.some(
      (r) => r === 'icon' || r.startsWith('apple-touch-icon'),
    );
    const href = isIcon ? absolute(attribute(tag, 'href'), base) : undefined;
    if (!isIcon || !href) continue;
    // An apple-touch-icon with no sizes is the 180px one by convention.
    const size =
      largest(attribute(tag, 'sizes')) ||
      (rel.some((r) => r.startsWith('apple-touch-icon')) ? 180 : 16);
    found.push({ href, size });
  }
  return found.toSorted((a, b) => b.size - a.size).map((d) => d.href);
}

/** The address of a page's web app manifest, if it links one. */
export function manifestUrl(html: string, base: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bmanifest\b/i.test(attribute(tag, 'rel'))) {
      return absolute(attribute(tag, 'href'), base);
    }
  }
  return undefined;
}

/** The icons a web app manifest lists, largest first. */
export function manifestIcons(json: string, base: string): string[] {
  try {
    const parsed = JSON.parse(json) as { icons?: unknown };
    if (!Array.isArray(parsed.icons)) return [];
    return parsed.icons
      .flatMap((icon: unknown): Declared[] => {
        if (typeof icon !== 'object' || icon === null) return [];
        const { src, sizes } = icon as { src?: unknown; sizes?: unknown };
        const href = typeof src === 'string' ? absolute(src, base) : undefined;
        return href
          ? [{ href, size: largest(typeof sizes === 'string' ? sizes : '') }]
          : [];
      })
      .toSorted((a, b) => b.size - a.size)
      .map((d) => d.href);
  } catch {
    return [];
  }
}

/** Every candidate in the order to try them, without repeats. */
export function iconCandidates(parts: {
  readonly page: readonly string[];
  readonly manifest: readonly string[];
  readonly feed: string;
  readonly site: string;
}): string[] {
  const favicon = absolute('/favicon.ico', parts.site);
  return [
    ...new Set(
      [...parts.page, ...parts.manifest, parts.feed, favicon].filter(
        (u): u is string => !!u,
      ),
    ),
  ];
}

/** Fetches a URL; injected so tests need no network. */
export type IconFetcher = (url: string) => Promise<Response>;

/** Most candidates tried for one feed, so a page cannot make us fetch forever. */
const MAX_TRIES = 8;

/** The first candidate that answers 2xx with an image, or blank when none does. */
export async function firstWorkingIcon(
  candidates: readonly string[],
  fetcher: IconFetcher,
): Promise<string> {
  for (const url of candidates.slice(0, MAX_TRIES)) {
    try {
      const response = await fetcher(url);
      const type = response.headers.get('content-type') ?? '';
      await response.body?.cancel();
      const isImage =
        type.startsWith('image/') ||
        type.includes('icon') ||
        (!type && /\.ico(\?|$)/i.test(url));
      if (response.ok && isImage) {
        return url;
      }
    } catch {
      // Try the next one.
    }
  }
  return '';
}
