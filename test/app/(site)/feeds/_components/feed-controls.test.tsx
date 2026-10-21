import { describe, expect, it } from '@jest/globals';

import { AddFeedForm } from '../../../../../src/app/(site)/feeds/_components/add-feed-form';
import { RefreshFeedsButton } from '../../../../../src/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '../../../../../src/app/(site)/feeds/_components/remove-feed-button';
import { html } from '../../../../components/render';

describe('the feed manager’s controls', () => {
  it('add a feed from a form that posts nowhere by itself', () => {
    const out = html(<AddFeedForm />);
    expect(out).toContain('<form class="addform">');
    expect(out).toContain('type="url"');
    expect(out).not.toContain('action=');
  });

  it('refresh with a plain button, not a form', () => {
    expect(html(<RefreshFeedsButton />)).toBe(
      '<button type="button" class="btn ghost small">Refresh now</button>',
    );
  });

  it('remove a feed with a plain button, not a form', () => {
    expect(html(<RemoveFeedButton id={3} />)).toBe(
      '<div><button type="button" class="btn danger">Remove</button></div>',
    );
  });
});
