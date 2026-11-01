import { describe, expect, it } from '@jest/globals';

import { MostRead } from '@/app/(site)/_components/most-read';
import type { ArticleSummary } from '@/domain/repository';
import { html } from '../../../components/render';

const article = (id: number, title: string | null) =>
  ({ id, url: `https://x/${id}`, title }) as ArticleSummary;

describe('MostRead', () => {
  it('prints nothing when nobody read anything', () => {
    expect(html(<MostRead stories={[]} />)).toBe('');
  });

  it('lists the stories with how many read each', () => {
    const out = html(
      <MostRead
        stories={[
          { article: article(1, 'Big'), count: 3, position: 0 },
          { article: article(2, null), count: 1, position: 1 },
        ]}
      />,
    );
    expect(out).toMatch(/<a[^>]*href="\/article\/1">Big<\/a>/);
    expect(out).toContain('3 readers');
    expect(out).toContain('https://x/2</a>');
    expect(out).toContain('1 reader<');
  });
});
