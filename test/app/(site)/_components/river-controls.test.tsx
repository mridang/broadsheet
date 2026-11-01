import { describe, expect, it } from '@jest/globals';

import {
  RiverPicker,
  UnpinRiverButton,
} from '@/app/(site)/_components/river-controls';
import { html } from '../../../components/render';

describe('RiverPicker', () => {
  it('offers each river to pin and both columns', () => {
    const out = html(
      <RiverPicker
        options={[
          { river_id: 'all', label: 'All stories' },
          { river_id: 'feed:4', label: 'Rust' },
        ]}
        next={{ left: 0, right: 1 }}
      />,
    );
    expect(out).toContain('<option value="feed:4">Rust</option>');
    expect(out).toContain('<option value="right">Right</option>');
    expect(out).toContain('Pin</button>');
  });
});

describe('UnpinRiverButton', () => {
  it('unpins with a plain button', () => {
    expect(html(<UnpinRiverButton id={2} />)).toMatch(
      /^<button type="button" class="[^"]*">Unpin<\/button>$/,
    );
  });
});
