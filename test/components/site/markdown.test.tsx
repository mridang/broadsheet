import { describe, expect, it } from '@jest/globals';

import { blocks, INLINE_MARKS, Markdown } from '@/components/site/markdown';
import { html } from '../render';

describe('blocks', () => {
  it('splits paragraphs, headings and lists', () => {
    expect(blocks('# Head\nText\n- a\n- b\n1. one\n2) two')).toEqual([
      { kind: 'h', text: 'Head' },
      { kind: 'p', text: 'Text' },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['one', 'two'] },
    ]);
  });
});

describe('Markdown', () => {
  it('renders bold, italic, code and lists', () => {
    expect(html(<Markdown text={'**b** *i* `c`\n- x'} />)).toBe(
      '<div><p><strong>b</strong> <em>i</em> <code>c</code></p><ul class="list-disc pl-5"><li>x</li></ul></div>',
    );
  });

  it('links citations to their article', () => {
    expect(html(<Markdown text="See [#12]." />)).toContain(
      '<a href="/article/12" class="focus-ring">[12]</a>',
    );
  });

  it.each([
    ['[a](https://x.test/)', 'href="https://x.test/"'],
    ['[a](/feeds)', 'href="/feeds"'],
  ])('links %s', (text, expected) => {
    expect(html(<Markdown text={text} />)).toContain(expected);
  });

  it.each(['[a](javascript:alert(1))', '[a](//evil.test)'])(
    'leaves %s as text',
    (text) => {
      expect(html(<Markdown text={text} />)).not.toContain('<a');
    },
  );

  it('never renders markup in the text', () => {
    expect(html(<Markdown text="<script>x</script>" />)).toContain(
      '&lt;script&gt;',
    );
  });
});

describe('blocks line forms', () => {
  const BULLET = new RegExp(['^[-*]', String.raw`\s`, '+(.*)$'].join(''));

  it.each([
    '-',
    '- ',
    '-x',
    '- x',
    '-   x y',
    '*\tx',
    '- a\rb',
    '-\r x',
    '1. x',
    '12) x',
    '1.x',
    '# x',
    '###### x',
    '####### x',
    '#x',
    '#   x',
  ])('reads %j as before', (raw) => {
    const [first] = blocks(raw);
    const line = raw.trim();
    const bullet = BULLET.exec(line);
    if (bullet) {
      expect(first).toEqual({ kind: 'ul', items: [bullet[1]] });
    } else {
      expect(first?.kind).not.toBe('ul');
    }
  });

  it('reads a long line of spaces quickly', () => {
    const started = Date.now();
    blocks(`-${' '.repeat(100_000)}x`);
    blocks(`#${' '.repeat(100_000)}`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('INLINE_MARKS', () => {
  const old = [
    String.raw`\[#(\d+)\]`,
    String.raw`\[([^\]]+)\]\(([^)\s]+)\)`,
    String.raw`\*\*([^*]+)\*\*`,
    String.raw`\*([^*\s][^*]*)\*`,
    '`([^`]+)`',
  ].join('|');
  const found = (text: string, pattern: string): unknown[] =>
    [...text.matchAll(new RegExp(pattern, 'g'))].map((m) => [m.index, ...m]);

  it.each([
    'see [#12] and [a link](https://x.org) with **bold**, *em* and `code`',
    '**a*b** *a **b***',
    '[x](a b) [](y) [#] [#1',
  ])('finds the same marks as the old pattern in %j', (text) => {
    expect(found(text, INLINE_MARKS)).toEqual(found(text, old));
  });

  it('matches the old pattern on seeded random text', () => {
    let state = 3;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
    const parts = ['[', ']', '(', ')', '#', '1', '*', '**', '`', ' ', 'a'];
    for (let i = 0; i < 5000; i += 1) {
      let text = '';
      for (let j = 0; j < 16; j += 1) {
        text += parts[Math.floor(random() * parts.length)];
      }
      expect(found(text, INLINE_MARKS)).toEqual(found(text, old));
    }
  });

  it('agrees on a long adversarial input', () => {
    const text = `${'[a'.repeat(20_000)}${'*b '.repeat(20_000)}`;
    expect(found(text, INLINE_MARKS)).toEqual(found(text, old));
  });
});
