import { describe, expect, it } from '@jest/globals';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { html } from '../../../../components/render';

describe('AddFeedForm', () => {
  it('adds a feed from a form that posts nowhere by itself', () => {
    const out = html(<AddFeedForm />);
    expect(out).toContain('<form class="addform">');
    expect(out).toContain('type="url"');
    expect(out).not.toContain('action=');
  });
});
