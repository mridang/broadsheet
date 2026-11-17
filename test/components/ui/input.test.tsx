import { describe, expect, it } from '@jest/globals';

import { Field, Toggle } from '@/components/ui/input';
import { html } from '../render';

const POINTS_ITS_LABEL_AT_PATTERN = /<label for="([^"]+)"/u;

describe('Field', () => {
  it('points its label at the control', () => {
    const out = html(
      <Field label="Address" hint="A feed’s URL">
        {(id) => <input id={id} aria-label="Address" />}
      </Field>,
    );
    const id = POINTS_ITS_LABEL_AT_PATTERN.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toMatch(new RegExp(`<input[^>]*id="${id}"`, 'u'));
    expect(out).toContain('A feed’s URL');
  });
});

describe('Toggle', () => {
  it('is a checkbox with the switch role, labelled by its words', () => {
    const out = html(
      <Toggle label="Mark read" description="On open" defaultChecked />,
    );
    expect(out).toContain('role="switch"');
    expect(out).toContain('checked=""');
    expect(out).toContain('Mark read');
    expect(out).toContain('On open');
  });
});
