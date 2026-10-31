import { describe, expect, it } from '@jest/globals';

import {
  BLANK,
  EditionForm,
  editionOf,
} from '@/app/(site)/editions/_components/edition-form';
import { html } from '../../../../components/render';

describe('EditionForm', () => {
  it('asks for a required name and offers to add the edition', () => {
    const out = html(<EditionForm draft={BLANK} sections={[]} />);
    expect(out).toContain('name="name"');
    expect(out).toContain('required');
    expect(out).toContain('Add edition</button>');
    expect(out).not.toContain('<fieldset>');
  });

  it('ticks the sections an edition prints, and saves in place', () => {
    const out = html(
      <EditionForm
        draft={{ ...BLANK, id: 4, name: 'Weekend', section_ids: [2] }}
        sections={[
          { id: 2, name: 'Tech' },
          { id: 3, name: 'Arts' },
        ]}
      />,
    );
    expect(out).toContain('checked="" value="2"');
    expect(out).not.toContain('checked="" value="3"');
    expect(out).toContain('Save</button>');
  });
});

describe('editionOf', () => {
  it('reads the form as the API takes it, blank rules as null', () => {
    const data = new FormData();
    data.set('name', ' Weekend ');
    data.append('section', '2');
    data.append('section', '3');
    data.set('query', '');
    data.set('tag', 'long');
    expect(editionOf(data)).toEqual({
      name: 'Weekend',
      section_ids: ['2', '3'],
      query: null,
      tag: 'long',
    });
  });
});
