import { describe, expect, it } from '@jest/globals';

import { StoryCard, StoryMenuItems } from '@/app/(site)/_components/story-card';
import type { Article } from '@/domain/repository';
import { html } from '../../../components/render';

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
    expect(out).toMatch(
      /<a class="[^"]*" data-story-link="" href="https:\/\/a\.test\/story" target="_blank" rel="noopener noreferrer" aria-label="A headline">/,
    );
    expect(out).toContain('data-url="https://a.test/story"');
    expect(out).toMatch(/<h2[^>]*>A headline<\/h2>/);
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
    expect(out).toMatch(/<ul[^>]*aria-label="Also covered by"/);
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
    expect(out).toMatch(/<del[^>]*>was said\. <\/del>/);
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
    expect(out).toMatch(/<button type="button" aria-label="More actions"/);
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
    expect(out).not.toMatch(/<article[^>]*opacity/);
    expect(out).toMatch(/<h2[^>]*group-data-read:opacity-55/);
  });

  it('lets the save button and the photo take clicks over the story link', async () => {
    const out = html(
      await StoryCard({
        article: article({ image: 'https://example.com/p.jpg' }),
        tier: 'standard',
        personal: true,
      }),
    );
    expect(out).toMatch(
      /<button[^>]*pointer-events-auto[^>]*data-action="save"/,
    );
    expect(out).toMatch(/<img[^>]*class="pointer-events-none /);
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
    ).toMatch(/src="\/img\?url=https%3A%2F%2Fexample\.com%2Fp\.jpg/);
  });
});
