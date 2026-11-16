import { describe, expect, it } from '@jest/globals';

import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import { html } from '../../../../components/render';

const EXPORTS_WITH_A_PLAIN_PATTERN =
  /^<button type="button" class="[^"]*">Export OPML<\/button>$/;

describe('ExportFeedsButton', () => {
  it('exports with a plain button, not a link', () => {
    expect(html(<ExportFeedsButton />)).toMatch(EXPORTS_WITH_A_PLAIN_PATTERN);
  });
});
