import { describe, expect, it } from '@jest/globals';

import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { html } from '../../../../components/render';

describe('AddSectionForm', () => {
  it('asks for a required name and offers to add it', () => {
    const out = html(<AddSectionForm />);
    expect(out).toContain('name="name"');
    expect(out).toContain('required');
    expect(out).toContain('Add section</button>');
  });
});
