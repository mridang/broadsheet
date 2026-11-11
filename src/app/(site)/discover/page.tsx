import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import {
  DiscoverList,
  type DiscoveredFeed,
} from '@/app/(site)/discover/_components/discover-list';
import {
  DiscoverTabs,
  tabOf,
  type Tab,
} from '@/app/(site)/discover/_components/discover-tabs';
import { SearchForm } from '@/app/(site)/discover/_components/search-form';
import { fetchJson } from '@/domain/api/discover';
import { getDatabase } from '@/domain/db/database';
import {
  GOOGLE_NEWS_TOPICS,
  googleNewsFeed,
  podcastsFrom,
} from '@/domain/discover';
import { Repository, type TrendingKind } from '@/domain/repository';
import { pictureSrc } from '@/domain/render/pictures';
import { getCurrentUser } from '@/lib/core/auth';
import { imageSigner } from '@/lib/cloudflare/images/server';
import { ButtonLink } from '@/components/ui/button';
import { CHIP } from '@/components/ui/badge';
import { EmptyState, ErrorText } from '@/components/ui/notice';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { countOf } from '@/lib/intl';

export const dynamic = 'force-dynamic';

/** Discover depends on the reader: never indexed. */
export const metadata: Metadata = {
  title: 'Discover',
  robots: { index: false, follow: false },
};

/** How many feeds a list shows. */
const LIMIT = 25;

/** The trending lists, as NewsBlur names them. */
const KINDS: readonly (readonly [TrendingKind, string, string])[] = [
  ['popular', 'Popular', 'The sites most read and followed this week.'],
  ['rising', 'Rising', 'Sites gaining followers fastest this week.'],
  ['hidden', 'Hidden gems', 'Small sites their few followers read the most.'],
  ['new', 'New', 'Sites first followed this week.'],
];

/** The trending kind a `kind` parameter names; popular when it names none. */
function kindOf(raw: string | undefined): TrendingKind {
  return KINDS.find(([k]) => k === raw)?.[0] ?? 'popular';
}

/** "1 follower", "3 followers". */
function count(n: number, noun: string): string {
  return countOf(n, noun);
}

/** A served picture for a remote one, through the image proxy. */
async function served(image: string | undefined): Promise<string | null> {
  return image ? pictureSrc(image, 96, imageSigner()) : null;
}

/** What one tab shows: its feeds, or why there are none. */
interface Found {
  readonly feeds: readonly DiscoveredFeed[];
  readonly failed?: string;
}

/** The trending sites of one kind, from the reader's view. */
async function trendingSites(uid: number, kind: TrendingKind): Promise<Found> {
  const sites = await new Repository(getDatabase()).trendingSites(
    uid,
    kind,
    7,
    LIMIT,
  );
  return {
    feeds: sites.map((s) => ({
      url: s.url,
      title: s.title,
      meta: [count(s.followers, 'follower')],
      followed: s.followed,
    })),
  };
}

/** The feeds editors put forward for everyone. */
async function recommended(followed: ReadonlySet<string>): Promise<Found> {
  const picks = await new Repository(getDatabase()).listRecommendations(
    'approved',
  );
  return {
    feeds: picks.slice(0, LIMIT).map((r) => ({
      url: r.url,
      title: r.title,
      detail: r.description,
      followed: followed.has(r.url),
    })),
  };
}

/** Podcasts iTunes finds for `q`. */
async function podcasts(
  q: string,
  followed: ReadonlySet<string>,
): Promise<Found> {
  const body = await fetchJson(
    `https://itunes.apple.com/search?${new URLSearchParams({
      term: q,
      media: 'podcast',
      entity: 'podcast',
      limit: String(LIMIT),
    })}`,
  );
  if (body === undefined) {
    return { feeds: [], failed: 'iTunes did not answer. Try again later.' };
  }
  return {
    feeds: await Promise.all(
      podcastsFrom(body).map(async (p) => ({
        url: p.feed_url,
        title: p.name,
        ...(p.author ? { detail: p.author } : {}),
        meta: [p.genre ?? '', p.episodes ? count(p.episodes, 'episode') : ''],
        picture: await served(p.artwork),
        ...(p.link ? { link: p.link } : {}),
        followed: followed.has(p.feed_url),
      })),
    ),
  };
}

/** Google News: a search for `q`, then each of its topics. */
function news(q: string, followed: ReadonlySet<string>): Found {
  const search = q ? googleNewsFeed({ query: q }) : undefined;
  const topics = GOOGLE_NEWS_TOPICS.flatMap((t) => {
    const feed = googleNewsFeed({ topic: t.id });
    return feed ? [{ ...feed, title: t.name }] : [];
  });
  return {
    feeds: [...(search ? [search] : []), ...topics].map((f) => ({
      url: f.feed_url,
      title: f.title ?? null,
      followed: followed.has(f.feed_url),
    })),
  };
}

/** What a tab says about itself, and what its search asks for. */
const ABOUT: Record<
  Tab,
  { title: string; search?: { label: string; placeholder: string } }
> = {
  sites: { title: 'Trending sites' },
  picks: { title: 'Recommended by the editors' },
  podcasts: {
    title: 'Podcasts',
    search: { label: 'Find podcasts', placeholder: 'A show, a topic, a host' },
  },
  news: {
    title: 'Google News',
    search: {
      label: 'Follow a Google News search',
      placeholder: 'Words to follow the news about',
    },
  },
};

/**
 * Discover, as NewsBlur has it: trending sites (popular, rising, hidden gems
 * and new), the editors' recommendations, podcasts from iTunes,
 * and Google News topics and searches, each with a "Follow" button. Every
 * tab and search is a link; the lists come straight from the same domain code
 * the Discover API answers with.
 */
export default async function DiscoverPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | undefined>>;
}>): Promise<ReactElement> {
  const given = await searchParams;
  const tab = tabOf(given['tab']);
  const kind = kindOf(given['kind']);
  const q = (given['q'] ?? '').trim().slice(0, 200);
  const user = await getCurrentUser();
  const about = ABOUT[tab];

  const header = (
    <PageHeader
      title="Discover"
      description="Find new feeds: what other readers follow, podcasts and the news."
    />
  );
  if (!user) {
    return (
      <div className="max-w-3xl">
        {header}
        <div className="mt-8">
          <EmptyState
            title="Sign in to discover feeds."
            action={<ButtonLink href="/login">Sign in</ButtonLink>}
          >
            Discover suggests feeds from what readers like you follow.
          </EmptyState>
        </div>
      </div>
    );
  }

  const feeds = await new Repository(getDatabase()).listFeeds(user.id);
  const followed = new Set(feeds.map((f) => f.url));
  let found: Found;
  switch (tab) {
    case 'sites': {
      found = await trendingSites(user.id, kind);
      break;
    }
    case 'picks': {
      found = await recommended(followed);
      break;
    }
    case 'podcasts': {
      found = q ? await podcasts(q, followed) : { feeds: [] };
      break;
    }
    default: {
      found = news(q, followed);
    }
  }

  return (
    <div className="max-w-3xl">
      {header}
      <DiscoverTabs current={tab} />
      {about.search ? (
        <SearchForm tab={tab} query={q} {...about.search} />
      ) : null}
      {tab === 'sites' ? (
        <nav aria-label="Trending" className="mt-6 flex flex-wrap gap-2">
          {KINDS.map(([k, label]) => (
            <Link
              key={k}
              href={`/discover?tab=sites&kind=${k}`}
              aria-current={k === kind ? 'page' : undefined}
              className={CHIP}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}
      <PageSection
        id="discover-results"
        title={
          tab === 'sites'
            ? (KINDS.find(([k]) => k === kind)?.[1] ?? about.title)
            : about.title
        }
        {...(tab === 'sites'
          ? { description: KINDS.find(([k]) => k === kind)?.[2] }
          : {})}
      >
        {found.failed ? <ErrorText>{found.failed}</ErrorText> : null}
        {found.feeds.length > 0 ? <DiscoverList feeds={found.feeds} /> : null}
        {found.feeds.length === 0 && !found.failed ? (
          <EmptyState
            icon="compass"
            title={
              tab === 'podcasts' && !q
                ? 'Search for a podcast to follow.'
                : 'Nothing to show here yet.'
            }
          />
        ) : null}
      </PageSection>
    </div>
  );
}
