/**
 * @packageDocumentation
 *
 * `/feed.xml?token=`: a person's saves (optionally one tag), the passages they
 * highlighted, one section or their whole edition as Atom, for a feed reader that has no session. The
 * token says which; only its SHA-256 is stored, so the token in the address
 * is the whole credential. This is a protocol endpoint outside `/api`, so its
 * errors are plain text.
 */

import { BRAND_NAME } from '@/app/_brand';
import { atomXml } from '@/domain/atom';
import { rfc3339 } from '@/domain/api/feed-resource';
import { OutboundRepository } from '@/domain/outbound';
import { verdict } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { compareText } from '@/lib/intl';
import { sha256Hex } from '@/lib/outbound/tokens';
import type { FeedFilter, FeedToken } from '@/domain/outbound';
import type { Verdict } from '@/domain/render/tiers';
import type { ArticleSummary } from '@/domain/repository';
import type { AtomEntry } from '@/domain/atom';
import type { Database } from '@/domain/db/client';

const WHEN_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const WHEN_PATTERN_2 = /\.\d{3}Z$/u;

/** A plain-text refusal. */
function refuse(status: number, text: string): Response {
  return new Response(`${text}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** A stored time as RFC 3339, or `fallback`. */
function when(stored: string | null | undefined, fallback: string): string {
  if (!stored) {
    return fallback;
  }
  if (WHEN_PATTERN.test(stored)) {
    return `${stored}T00:00:00Z`;
  }
  const parsed = rfc3339(stored) ?? new Date(stored).toISOString();
  return Number.isNaN(Date.parse(parsed))
    ? fallback
    : parsed.replace(WHEN_PATTERN_2, 'Z');
}

/** One story as an entry. */
function entryOf(
  article: ArticleSummary,
  origin: string,
  updated: string,
  extra: Pick<AtomEntry, 'content' | 'categories'> = {},
): AtomEntry {
  return {
    id: `${origin}/article/${article.id}`,
    title: article.title || article.url,
    url: article.url,
    updated,
    summary: article.summary || undefined,
    source: article.source || undefined,
    ...extra,
  };
}

/**
 * A saved story's highlights as the text of an entry: each passage quoted, then
 * the saver's note, as NewsBlur's highlights feed shows them.
 */
export function highlightsText(
  highlights: readonly string[],
  notes: string | null,
): string {
  return [...highlights.map((h) => `“${h}”`), ...(notes ? [notes] : [])].join(
    '\n\n',
  );
}

/** Whether a story with this verdict belongs in a feed with this filter. */
export function keeps(filter: FeedFilter, score: Verdict): boolean {
  if (filter === 'focus') {
    return score > 0;
  }
  if (filter === 'unread') {
    return score >= 0;
  }
  return true;
}

/** The feed's title and entries for what the token shows. */
async function contentOf(
  db: Database,
  token: FeedToken,
  origin: string,
  now: string,
): Promise<{ title: string; site?: string; entries: AtomEntry[] } | undefined> {
  const repo = new Repository(db);
  const outbound = new OutboundRepository(db);
  if (token.scope === 'saves') {
    const listed = await repo.listSaves(token.user_id, token.tag ?? undefined);
    const saves = listed.slice(0, 100);
    const bodies = await outbound.bodies(saves.map((s) => s.article.id));
    return {
      title: token.tag ? `Saved: ${token.tag}` : 'Saved stories',
      site: token.tag
        ? `${origin}/saved?tag=${encodeURIComponent(token.tag)}`
        : `${origin}/saved`,
      entries: saves.map((s) =>
        entryOf(s.article, origin, when(s.saved_at, now), {
          content: bodies.get(s.article.id),
          categories: s.tags,
        }),
      ),
    };
  }
  if (token.scope === 'highlights') {
    const saved = await repo.listSaves(token.user_id);
    const marked = saved.filter((s) => s.highlights?.length).slice(0, 100);
    return {
      title: 'Highlights',
      site: `${origin}/saved`,
      entries: marked.map((s) =>
        entryOf(s.article, origin, when(s.saved_at, now), {
          content: highlightsText(s.highlights ?? [], s.notes ?? null),
          categories: s.tags,
        }),
      ),
    };
  }
  if (token.scope === 'search') {
    const search =
      token.search_id === null
        ? undefined
        : await repo.getSearch(token.user_id, token.search_id);
    if (!search) {
      return undefined;
    }
    const found = await repo.searchArticles(token.user_id, {
      q: search.query,
      ...(search.feed_id === null ? {} : { feed: search.feed_id }),
      limit: 100,
    });
    return {
      title: `Search: ${search.query}`,
      entries: found
        .slice(0, 100)
        .map((a) => entryOf(a, origin, when(a.published_at || a.edition, now))),
    };
  }
  const section =
    token.scope === 'section' && token.section_id !== null
      ? await repo.getSection(token.user_id, token.section_id)
      : undefined;
  if (token.scope === 'section' && !section) {
    return undefined;
  }
  const title = section?.name ?? 'Today’s edition';
  const training =
    token.filter === 'all' ? [] : await repo.listClassifiers(token.user_id);
  const edition = await outbound.editionStories(
    token.user_id,
    token.scope === 'section' ? (token.section_id ?? undefined) : undefined,
  );
  const stories = edition.filter((a) =>
    keeps(token.filter, verdict(a, training)),
  );
  const bodies = await outbound.bodies(stories.map((a) => a.id));
  return {
    title: token.filter === 'focus' ? `${title} (focus)` : title,
    entries: stories.map((a) =>
      entryOf(a, origin, when(a.published_at || a.edition, now), {
        content: bodies.get(a.id),
      }),
    ),
  };
}

/**
 * Answer `GET /feed.xml?token=`: the Atom feed, 400 without a token, 404 for
 * a token that is unknown, revoked, or names a section that is gone.
 */
export async function serveFeed(
  request: Request,
  db: Database,
  origin: string,
  now: Date = new Date(),
): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return refuse(400, 'Add ?token= with a feed token.');
  }
  const row = await new OutboundRepository(db).feedTokenByHash(
    await sha256Hex(token),
  );
  const stamp = now.toISOString().replace(WHEN_PATTERN_2, 'Z');
  const content = row ? await contentOf(db, row, origin, stamp) : undefined;
  if (!row || !content) {
    return refuse(404, 'No such feed.');
  }
  const updated = content.entries.reduce(
    (latest, event) =>
      compareText(event.updated, latest) > 0 ? event.updated : latest,
    content.entries[0]?.updated ?? stamp,
  );
  return new Response(
    atomXml({
      id: `${origin}/feed.xml#${row.id}`,
      title: `${BRAND_NAME}: ${content.title}`,
      self: `${origin}/feed.xml`,
      site: content.site ?? origin,
      updated,
      entries: content.entries,
    }),
    {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'X-Robots-Tag': 'noindex',
      },
    },
  );
}
