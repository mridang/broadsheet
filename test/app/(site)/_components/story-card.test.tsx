import { describe, expect, it } from '@jest/globals';

import { StoryCard, StoryMenuItems } from '@/app/(site)/_components/story-card';
import { html } from '../../../components/render';
import type { Article } from '@/domain/repository';

const IS_COVERED_BY_ONE_PATTERN =
  /<a class="[^"]*" data-story-link="" href="https:\/\/a\.test\/story" target="_blank" rel="noopener noreferrer" aria-label="A headline">/u;
const IS_COVERED_BY_ONE_PATTERN_2 = /<h2[^>]*>A headline<\/h2>/u;
const BADGES_A_CLUSTERED_STORY_PATTERN =
  /<ul[^>]*aria-label="Also covered by"/u;
const SHOWS_WHAT_CHANGED_IN_PATTERN = /<del[^>]*>was said\. <\/del>/u;
const LETS_A_READER_SHARE_PATTERN =
  /<button type="button" aria-label="More actions"/u;
const DIMS_A_READ_STORY_S_PATTERN = /<article[^>]*opacity/u;
const DIMS_A_READ_STORY_S_PATTERN_2 = /<h2[^>]*group-data-read:opacity-55/u;
const LETS_THE_SAVE_BUTTON_PATTERN =
  /<button[^>]*pointer-events-auto[^>]*data-action="save"/u;
const LETS_THE_SAVE_BUTTON_PATTERN_2 = /<img[^>]*class="pointer-events-none /u;
const SHOWS_ITS_PHOTO_THROUGH_PATTERN =
  /src="\/img\?url=https%3A%2F%2Fexample\.com%2Fp\.jpg/u;

const article = (over: Partial<Article> = {}): Article =>
  ({
    id: 7,
    source_id: 1,
    url: 'https://a.test/story',
    title: 'A headline',
    source: 'A Source',
    image: null,
    favicon: null,
    summary: 'What happened, at some length.',
    published_at: null,
    points: 42,
    body_text: null,
    edition: '2026-11-01',
    cluster_id: null,
    fetched_at: null,
    ...over,
  }) as Article;

describe('StoryCard', () => {
  it('is covered by one link to the story, named by its headline', async () => {
    const out = html(await StoryCard({ article: article(), tier: 'standard' }));
    expect(out).toMatch(IS_COVERED_BY_ONE_PATTERN);
    expect(out).toContain('data-url="https://a.test/story"');
    expect(out).toMatch(IS_COVERED_BY_ONE_PATTERN_2);
    expect(out).toContain('▲ 42');
  });

  it('prints where the story lives', async () => {
    expect(
      html(await StoryCard({ article: article(), tier: 'lead' })),
    ).toContain('print:after:content-[attr(data-url)]');
  });

  it('names the other sources that covered it', async () => {
    expect(
      html(
        await StoryCard({
          article: article(),
          tier: 'feature',
          also: ['B', 'C'],
        }),
      ),
    ).toContain('Also covered by: B, C');
  });

  it('badges a clustered story and previews each other copy', async () => {
    const out = html(
      await StoryCard({
        article: article(),
        tier: 'standard',
        also: ['B'],
        siblings: [
          {
            id: 8,
            source: 'B',
            url: 'https://b.test/1',
            tier: 'title',
            title: 'Same',
          },
          { id: 9, source: 'C', url: 'https://c.test/1', tier: 'related' },
        ],
        readIds: new Set([8]),
      }),
    );
    expect(out).toContain('+2 sources');
    expect(out).toMatch(BADGES_A_CLUSTERED_STORY_PATTERN);
    expect(out).toContain('href="https://b.test/1"');
    expect(out).not.toContain('Also covered by: B');
  });

  it('shows what changed in a story whose text changed', async () => {
    const out = html(
      await StoryCard({
        article: article({ original_summary: 'What was said.' }),
        tier: 'standard',
      }),
    );
    expect(out).toContain('show changes');
    expect(out).toMatch(SHOWS_WHAT_CHANGED_IN_PATTERN);
  });

  it('offers no changes when the text is the same', async () => {
    const out = html(
      await StoryCard({
        article: article({ original_summary: null }),
        tier: 'standard',
      }),
    );
    expect(out).not.toContain('show changes');
  });

  it('lets a reader share the story', async () => {
    const out = html(
      await StoryCard({
        article: article(),
        tier: 'standard',
        personal: true,
        shared: true,
      }),
    );
    expect(out).toMatch(LETS_A_READER_SHARE_PATTERN);
    const items = html(
      <StoryMenuItems
        article={article()}
        excerpt=""
        source="A Source"
        personal
        shared
      />,
    );
    expect(items).toContain('data-action="share"');
    expect(items).toContain('✓ Shared');
  });

  it('dims a read story and gives a reader its id and controls', async () => {
    const out = html(
      await StoryCard({
        article: article(),
        tier: 'standard',
        personal: true,
        read: true,
      }),
    );
    expect(out).toContain('data-article-id="7"');
    expect(out).toContain('data-read=""');
    expect(out).toContain('data-action="save"');
  });

  it("dims a read story's words, never the card that holds its menu", async () => {
    const out = html(
      await StoryCard({
        article: article(),
        tier: 'standard',
        personal: true,
        read: true,
      }),
    );
    expect(out).not.toMatch(DIMS_A_READ_STORY_S_PATTERN);
    expect(out).toMatch(DIMS_A_READ_STORY_S_PATTERN_2);
  });

  it('lets the save button and the photo take clicks over the story link', async () => {
    const out = html(
      await StoryCard({
        article: article({ image: 'https://example.com/p.jpg' }),
        tier: 'standard',
        personal: true,
      }),
    );
    expect(out).toMatch(LETS_THE_SAVE_BUTTON_PATTERN);
    expect(out).toMatch(LETS_THE_SAVE_BUTTON_PATTERN_2);
  });

  it('highlights the headline only when the story link is hovered', async () => {
    const out = html(await StoryCard({ article: article(), tier: 'feature' }));
    expect(out).not.toContain('group-hover:text-accent');
    expect(out).toContain('group-has-[[data-story-link]:hover]:text-accent');
  });

  it('gives a visitor no controls and no id', async () => {
    const out = html(await StoryCard({ article: article(), tier: 'standard' }));
    expect(out).not.toContain('data-article-id');
    expect(out).not.toContain('data-action="save"');
  });

  it('links the full text only when it was kept', () => {
    const items = (over: Partial<Article>) =>
      html(
        <StoryMenuItems
          article={article(over)}
          excerpt=""
          source="A Source"
          personal={false}
          shared={false}
        />,
      );
    expect(items({})).not.toContain('data-action="full-text"');
    expect(items({ body_text: 'All of it.' })).toContain(
      'data-action="full-text" href="/article/7"',
    );
  });

  it('shows its photo through the image proxy', async () => {
    expect(
      html(
        await StoryCard({
          article: article({ image: 'https://example.com/p.jpg' }),
          tier: 'feature',
        }),
      ),
    ).toMatch(SHOWS_ITS_PHOTO_THROUGH_PATTERN);
  });
});
