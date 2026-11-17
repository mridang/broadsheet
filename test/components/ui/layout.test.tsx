import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { Container, Eyebrow, Heading } from '@/components/ui/layout';
import { cssClassesOf, html } from '../render';

const TEXT_TONE_CLASS = /\btext-(ink|accent|subtle|muted|on-ink)\b/u;
const FOCUSABLE_H1 = /<h1 tabindex="-1" class=/u;

describe('Eyebrow', () => {
  it('is a tracked-caps paragraph in the accent colour by default', () => {
    const out = html(<Eyebrow>Your collection</Eyebrow>);
    expect(out.startsWith('<p')).toBe(true);
    const classes = cssClassesOf(out, 'p');
    expect(classes).toContain('uppercase');
    expect(classes).toContain('text-accent');
  });

  it('takes its colour from the tone, one at a time', () => {
    const ink = cssClassesOf(html(<Eyebrow tone="ink">x</Eyebrow>), 'p');
    expect(ink).toContain('text-ink');
    expect(ink).not.toContain('text-accent');
    expect(
      cssClassesOf(html(<Eyebrow tone="subtle">x</Eyebrow>), 'p'),
    ).toContain('text-subtle');
  });

  it('can label a term or a heading instead of being a paragraph', () => {
    expect(html(<Eyebrow as="dt">Serves</Eyebrow>).startsWith('<dt')).toBe(
      true,
    );
    expect(html(<Eyebrow as="h3">Cookware</Eyebrow>).startsWith('<h3')).toBe(
      true,
    );
  });

  it('is never given a colour class by a caller, since classes are joined and not merged', async () => {
    // Two colour classes on one element are decided by the order Tailwind
    // generated them in, not by the order they were written. The tone prop is
    // the way to choose a colour.
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const name of await readdir(dir)) {
        const file = path.join(dir, name);
        const info = await stat(file);
        if (info.isDirectory()) {
          await walk(file);
        } else if (
          file.endsWith('.tsx') &&
          !file.includes(`${path.sep}views${path.sep}`)
        ) {
          const source = await readFile(file, 'utf8');
          offenders.push(
            ...[
              ...source.matchAll(/<Eyebrow\b[^>]*className="([^"]*)"/gu),
            ].flatMap((match) =>
              TEXT_TONE_CLASS.test(match[1]!) ? [`${file}: ${match[1]}`] : [],
            ),
          );
        } else {
          // Stylesheets, tests and other files are not checked.
        }
      }
    };
    await walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('Heading', () => {
  it('can be made focusable by script, for moving focus to it between steps', () => {
    const out = html(
      <Heading as="h1" tabIndex={-1}>
        Title
      </Heading>,
    );
    expect(out).toMatch(FOCUSABLE_H1);
    expect(html(<Heading>Title</Heading>)).not.toContain('tabindex');
  });

  it('is an h2 in the display face unless told otherwise', () => {
    const out = html(<Heading>Title</Heading>);
    expect(out.startsWith('<h2')).toBe(true);
    expect(cssClassesOf(out, 'h2')).toContain('font-display');
  });

  it('sets the tag and the size separately', () => {
    const out = html(
      <Heading as="h1" variant="display">
        Big
      </Heading>,
    );
    expect(out.startsWith('<h1')).toBe(true);
    expect(cssClassesOf(out, 'h1')).toContain('text-5xl');
  });
});

describe('Container', () => {
  it('centres the content in the page column', () => {
    expect(cssClassesOf(html(<Container>x</Container>), 'div')).toContain(
      'mx-auto',
    );
  });
});
