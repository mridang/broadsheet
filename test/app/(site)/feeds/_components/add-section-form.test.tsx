import { describe, expect, it } from '@jest/globals';

import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { html } from '../../../../components/render';

describe('AddSectionForm', () => {
  it('asks for a required name and offers to add it', () => {
    const out = html(<AddSectionForm sections={[]} />);
    expect(out).toContain('name="name"');
    expect(out).toContain('required');
    expect(out).toContain('Add section</button>');
  });

  it('offers no parent while there are no sections', () => {
    expect(html(<AddSectionForm sections={[]} />)).not.toContain('<select');
  });

  it('offers the top level and every section as the parent', () => {
    const out = html(
      <AddSectionForm sections={[{ id: 2, name: 'Tech · AI' }]} />,
    );
    expect(out).toContain('>Top level</option>');
    expect(out).toContain('<option value="2">Tech · AI</option>');
  });
});
