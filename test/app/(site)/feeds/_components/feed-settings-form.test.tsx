import { describe, expect, it } from '@jest/globals';

import { FeedSettingsForm } from '@/app/(site)/feeds/_components/feed-settings-form';
import { html } from '../../../../components/render';

const form = (muted: boolean, sectionId: number | null) =>
  html(
    <FeedSettingsForm
      id={3}
      title="Mine"
      muted={muted}
      sectionId={sectionId}
      sections={[
        { id: 1, name: 'Tech' },
        { id: 2, name: 'Science' },
      ]}
    />,
  );

describe('FeedSettingsForm', () => {
  it('shows the feed’s current name', () => {
    expect(form(false, null)).toContain('value="Mine"');
  });

  it('offers every section and no section', () => {
    const out = form(false, null);
    expect(out).toContain('>No section</option>');
    expect(out).toContain('>Tech</option>');
    expect(out).toContain('>Science</option>');
  });

  it('selects the section the feed is filed under', () => {
    expect(form(false, 2)).toContain('<option value="2" selected="">Science');
  });

  it('ticks the mute switch only for a muted feed', () => {
    expect(form(true, null)).toContain('checked=""');
    expect(form(false, null)).not.toContain('checked=""');
  });
});
