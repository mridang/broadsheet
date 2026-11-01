import { describe, expect, it } from '@jest/globals';

import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import { html } from '../../../../components/render';

describe('ExportFeedsButton', () => {
  it('exports with a plain button, not a link', () => {
    expect(html(<ExportFeedsButton />)).toMatch(
      /^<button type="button" class="[^"]*">Export OPML<\/button>$/,
    );
  });
});
