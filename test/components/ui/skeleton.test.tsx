import { describe, expect, it } from '@jest/globals';

import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { html } from '../render';

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    expect(html(<Skeleton className="h-4" />)).toContain('aria-hidden="true"');
  });
});

describe('SkeletonRows', () => {
  it('says it is loading, once, for all of its rows', () => {
    const out = html(<SkeletonRows rows={3} />);
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Loading"');
  });
});
