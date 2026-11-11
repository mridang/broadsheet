import { describe, expect, it } from '@jest/globals';

import {
  ClusterBadge,
  ClusterPreview,
  clusterPictures,
} from '@/app/(site)/_components/cluster-preview';
import type { Sibling } from '@/domain/render/layout';
import { html } from '../../../components/render';

const siblings: Sibling[] = [
  {
    id: 8,
    source: 'B',
    url: 'https://b.test/1',
    tier: 'title',
    title: 'Same headline',
    image: 'https://example.com/p.jpg',
    excerpt: 'The opening.',
  },
  { id: 9, source: '', url: 'https://c.test/1', tier: 'related' },
];

describe('ClusterBadge', () => {
  it('counts the other sources and names them', () => {
    const out = html(<ClusterBadge siblings={siblings} />);
    expect(out).toContain('+2 sources');
    expect(out).toContain('>Also told by B, </span>');
    expect(out).not.toContain('title=');
  });

  it('says source for one', () => {
    expect(html(<ClusterBadge siblings={siblings.slice(0, 1)} />)).toContain(
      '+1 source<',
    );
  });
});

describe('clusterPictures', () => {
  it('asks for no pictures unless expanded', async () => {
    expect(await clusterPictures(siblings, false)).toEqual([null, null]);
  });
});

describe('ClusterPreview', () => {
  it('lists each copy on one line, tagged Match or Related', async () => {
    const out = html(<ClusterPreview siblings={siblings} />);
    expect(out).toContain('>Same headline<');
    expect(out).toContain('>Match<');
    expect(out).toContain('>Related<');
    expect(out).toContain('>c.test<');
    expect(out).not.toContain('The opening.');
    expect(out).not.toContain('<img');
  });

  it('shows pictures and openings when expanded', async () => {
    const pictures = await clusterPictures(siblings, true);
    const out = html(
      <ClusterPreview siblings={siblings} expanded pictures={pictures} />,
    );
    expect(out).toContain('The opening.');
    expect(out).toMatch(/src="\/img\?url=https%3A%2F%2Fexample\.com%2Fp\.jpg/);
  });

  it('dims the copies the reader read', async () => {
    const out = html(
      <ClusterPreview siblings={siblings} read={new Set([9])} />,
    );
    expect(out.match(/data-read=""/g)).toHaveLength(1);
  });
});
