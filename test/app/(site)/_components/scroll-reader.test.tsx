import { describe, expect, it } from '@jest/globals';

import { ScrollReader } from '@/app/(site)/_components/scroll-reader';
import { html } from '../../../components/render';

describe('ScrollReader', () => {
  it('renders nothing', () => {
    expect(html(<ScrollReader />)).toBe('');
  });
});
