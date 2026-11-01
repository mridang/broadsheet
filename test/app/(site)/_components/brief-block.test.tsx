import { describe, expect, it } from '@jest/globals';

import { BriefBlock } from '@/app/(site)/_components/brief-block';
import type { Article } from '@/domain/repository';
import { html } from '../../../components/render';

describe('BriefBlock', () => {
  it('lists each story with its source, and prints each address', () => {
    const out = html(
      <BriefBlock
        items={[
          {
            id: 1,
            url: 'https://b.test/x',
            title: 'Short one',
            source: null,
          } as unknown as Article,
        ]}
      />,
    );
    expect(out).toContain('In brief');
    expect(out).toContain('href="https://b.test/x"');
    expect(out).toContain('Short one');
    expect(out).toContain('b.test');
    expect(out).toContain('attr(href)');
  });
});
