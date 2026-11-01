import { describe, expect, it } from '@jest/globals';

import { FrontPage } from '@/app/(site)/_components/front-page';
import { html } from '../../../components/render';

describe('FrontPage', () => {
  it('titles the paper and holds its bar, switcher, paper and column', () => {
    const out = html(
      <FrontPage
        title="Your paper"
        description="From your feeds."
        bar={<span>bar</span>}
        switcher={<span>switcher</span>}
        side={<span>side</span>}
      >
        <p>paper</p>
      </FrontPage>,
    );
    expect(out).toMatch(/<h1[^>]*>Your paper<\/h1>/);
    ['From your feeds.', 'bar', 'switcher', 'side', 'paper'].forEach((text) =>
      expect(out).toContain(text),
    );
  });

  it('leaves out the switcher and column when there are none', () => {
    const out = html(
      <FrontPage title="Back issue" description="d" bar={null}>
        x
      </FrontPage>,
    );
    expect(out).not.toContain('xl:sticky');
  });
});
