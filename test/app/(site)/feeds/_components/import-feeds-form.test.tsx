import { describe, expect, it } from '@jest/globals';

import { ImportFeedsForm } from '@/app/(site)/feeds/_components/import-feeds-form';
import { html } from '../../../../components/render';

describe('ImportFeedsForm', () => {
  it('takes one OPML file', () => {
    const out = html(<ImportFeedsForm />);
    expect(out).toContain('type="file"');
    expect(out).toContain('accept=".opml,.xml,text/x-opml,text/xml"');
    expect(out).toContain('Import OPML');
  });
});
