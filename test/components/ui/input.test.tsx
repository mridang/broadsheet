import { describe, expect, it } from '@jest/globals';

import {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui/input';
import { fieldClass } from '@/components/ui/field';
import { classOf, html } from '../render';

describe('Input', () => {
  it('wears the field look of its size', () => {
    expect(classOf(html(<Input />), 'input')).toBe(fieldClass(undefined, 'md'));
    expect(classOf(html(<Input size="sm" />), 'input')).toContain('h-8');
  });
});

describe('Select', () => {
  it('leaves room for its arrow', () => {
    const out = html(
      <Select>
        <option>a</option>
      </Select>,
    );
    expect(classOf(out, 'select')).toContain('pr-8');
  });
});

describe('Textarea', () => {
  it('fills its column', () => {
    expect(classOf(html(<Textarea />), 'textarea')).toContain('w-full');
  });
});

describe('Field', () => {
  it('points its label at the control', () => {
    const out = html(
      <Field label="Address" hint="A feed’s URL">
        {(id) => <Input id={id} />}
      </Field>,
    );
    const id = /<label for="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toMatch(new RegExp(`<input[^>]*id="${id}"`));
    expect(out).toContain('A feed’s URL');
  });
});

describe('Checkbox', () => {
  it('is a tick box inside its label', () => {
    expect(html(<Checkbox label="Muted" />)).toMatch(
      /<label[^>]*><input type="checkbox"[^>]*\/>Muted<\/label>/,
    );
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
