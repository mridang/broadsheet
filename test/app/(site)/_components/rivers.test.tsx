import { describe, expect, it } from '@jest/globals';

import { Rivers } from '@/app/(site)/_components/rivers';
import type { ArticleSummary } from '@/domain/repository';
import { html } from '../../../components/render';

const river = (id: number, side: 'left' | 'right') => ({
  id,
  user_id: 7,
  river_id: 'all',
  side,
  position: 0,
  created_at: null,
});

describe('Rivers', () => {
  it('prints each column’s rivers with their stories, left first', () => {
    const out = html(
      <Rivers
        rivers={[
          {
            river: river(2, 'right'),
            label: 'Saved',
            stories: [],
          },
          {
            river: river(1, 'left'),
            label: 'Rust',
            stories: [
              { id: 9, url: 'https://x/9', title: 'Nine' } as ArticleSummary,
            ],
          },
        ]}
        options={[]}
      />,
    );
    expect(out.indexOf('Rust')).toBeLessThan(out.indexOf('Saved'));
    expect(out).toContain('<a href="/article/9">Nine</a>');
    expect(out).toContain('Pin a river');
  });
});
