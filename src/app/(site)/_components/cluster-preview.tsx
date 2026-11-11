import { Badge } from '@/components/ui/badge';
import type { Sibling } from '@/domain/render/layout';
import { ago, hostOf } from '@/domain/render/tiers';
import { pictureSrc } from '@/domain/render/pictures';
import { imageSigner } from '@/lib/cloudflare/images/server';
import { cn } from '@/components/ui/cn';
import { countOf } from '@/lib/intl';

/** The width an expanded preview's picture is asked for, in pixels. */
const PREVIEW_WIDTH = 160;

/** How the badge names the copies: the same headline, or the same story. */
const MATCH = { title: 'Match', related: 'Related' } as const;

/** The badge beside a clustered story's source: how many others told it. */
export function ClusterBadge({
  siblings,
}: Readonly<{ siblings: readonly Sibling[] }>) {
  const n = siblings.length;
  return (
    <span>
      <Badge tone="accent">+{countOf(n, 'source')}</Badge>
      <span className="sr-only">
        {`Also told by ${siblings.map((s) => s.source).join(', ')}`}
      </span>
    </span>
  );
}

/**
 * The pictures an `expanded` preview shows, one per copy (null for none),
 * through the image proxy.
 */
export async function clusterPictures(
  siblings: readonly Sibling[],
  expanded: boolean,
): Promise<(string | null)[]> {
  const signer = imageSigner();
  return Promise.all(
    siblings.map((s) =>
      expanded && s.image
        ? pictureSrc(s.image, PREVIEW_WIDTH, signer)
        : Promise.resolve(null),
    ),
  );
}

/**
 * The other sources' copies of a clustered story, as NewsBlur lists them under
 * it: each copy's source, headline and age on one line, its picture and
 * opening too when the reader asked for `expanded` previews, dimmed once
 * read, and tagged Match or Related by how the cluster joined it. `pictures`
 * come from `clusterPictures`.
 */
export function ClusterPreview({
  siblings,
  expanded = false,
  pictures = [],
  read = new Set<number>(),
}: Readonly<{
  siblings: readonly Sibling[];
  expanded?: boolean;
  pictures?: readonly (string | null)[];
  read?: ReadonlySet<number>;
}>) {
  return (
    <ul
      data-part=""
      aria-label="Also covered by"
      className="pointer-events-auto relative z-10 mt-3 divide-y divide-line rounded-control border border-line bg-surface"
    >
      {siblings.map((s, i) => (
        <li
          key={s.id}
          data-read={read.has(s.id) ? '' : undefined}
          className="data-read:opacity-55"
        >
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'focus-ring-flush flex gap-3 rounded-control px-3 py-2 text-sm hover:bg-ink/5',
              expanded ? 'items-start' : 'items-center',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-xs text-subtle">
                <span className="truncate font-medium">
                  {s.source || hostOf(s.url)}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-label font-semibold uppercase',
                    s.tier === 'title'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-ink/5 text-muted',
                  )}
                >
                  {MATCH[s.tier]}
                </span>
                {s.published_at ? (
                  <span className="shrink-0">{ago(s.published_at)}</span>
                ) : null}
              </span>
              <span
                className={cn(
                  'mt-0.5 block font-medium text-ink',
                  !expanded && 'truncate',
                )}
              >
                {s.title || s.url}
              </span>
              {expanded && s.excerpt ? (
                <span className="mt-1 line-clamp-3 block text-muted">
                  {s.excerpt}
                </span>
              ) : null}
            </span>
            {pictures[i] ? (
              <img
                src={pictures[i]}
                alt=""
                loading="lazy"
                className="h-14 w-20 shrink-0 rounded-control bg-ink/5 object-cover"
              />
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
