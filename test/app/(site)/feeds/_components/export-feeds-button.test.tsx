import { describe, expect, it } from '@jest/globals';

import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import { html } from '../../../../components/render';

describe('ExportFeedsButton', () => {
  it('exports with a plain button, not a link', () => {
    expect(html(<ExportFeedsButton />)).toBe(
      '<button type="button" class="btn ghost small">Export OPML</button>',
    );
  });
});
