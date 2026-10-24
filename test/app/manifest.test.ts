import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { BACKGROUND_COLOR, THEME_COLOR } from '@/app/_brand';
import manifest from '@/app/manifest';
import { pngSize } from '../png';

/** The names of the chunks a PNG file is made of, in order. */
function pngChunks(file: string): readonly string[] {
  const bytes = readFileSync(file);
  const walk = (offset: number): readonly string[] =>
    offset >= bytes.length
      ? []
      : [
          bytes.toString('ascii', offset + 4, offset + 8),
          ...walk(offset + 12 + bytes.readUInt32BE(offset)),
        ];
  return walk(8);
}

describe('web app manifest', () => {
  const m = manifest();

  it('meets what Chrome needs to offer an install', () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toMatch(/^\//);
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('has a maskable icon so Android does not shrink it inside a white circle', () => {
    expect((m.icons ?? []).some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('points every icon at a file that exists', () => {
    for (const icon of m.icons ?? []) {
      expect(existsSync(path.join(process.cwd(), 'public', icon.src))).toBe(
        true,
      );
    }
  });

  it('declares each icon at the size the file really has', () => {
    for (const icon of m.icons ?? []) {
      const { width, height } = pngSize(
        path.join(process.cwd(), 'public', icon.src),
      );
      expect(icon.sizes).toBe(`${width}x${height}`);
    }
  });

  it('has a monochrome icon for Android themed icons', () => {
    const mono = (m.icons ?? []).filter((i) => i.purpose === 'monochrome');
    expect(mono.map((i) => i.sizes)).toEqual(['512x512']);
  });

  it('reuses the open window when the installed app is launched again', () => {
    expect(m.launch_handler).toEqual({ client_mode: 'navigate-existing' });
  });

  it('points every shortcut inside its scope', () => {
    for (const shortcut of m.shortcuts ?? []) {
      expect(shortcut.url.startsWith(m.scope!)).toBe(true);
    }
  });

  it('turns the browser bar the brand colour, with the page colour behind the splash', () => {
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(m.background_color).toBe(BACKGROUND_COLOR);
  });

  it('has an id, a language and a store category', () => {
    expect(m.id).toBe('/');
    expect(m.lang).toBe('en');
    expect(m.categories?.length).toBeGreaterThan(0);
  });

  // Chrome only shows the rich install dialog when a screenshot of each form
  // factor exists; whatever is declared must be a real, correctly sized file.
  it('declares screenshots Chrome will accept, if any', () => {
    const shots = m.screenshots ?? [];
    for (const shot of shots) {
      const { width, height } = pngSize(
        path.join(process.cwd(), 'public', shot.src),
      );
      expect(shot.sizes).toBe(`${width}x${height}`);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(320);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
      expect(
        Math.max(width, height) / Math.min(width, height),
      ).toBeLessThanOrEqual(2.3);
      expect(['wide', 'narrow']).toContain(shot.form_factor);
    }
    for (const factor of ['wide', 'narrow']) {
      const ratios = new Set(
        shots.filter((s) => s.form_factor === factor).map((s) => s.sizes),
      );
      expect(ratios.size).toBeLessThanOrEqual(1);
    }
  });

  it('carries no text or camera metadata in the screenshots, which are public', () => {
    const allowed = new Set(['IHDR', 'PLTE', 'tRNS', 'pHYs', 'IDAT', 'IEND']);
    for (const shot of m.screenshots ?? []) {
      const chunks = pngChunks(path.join(process.cwd(), 'public', shot.src));
      expect(chunks.filter((c) => !allowed.has(c))).toEqual([]);
    }
  });

  it('keeps each screenshot below the weight of the page it advertises', () => {
    for (const shot of m.screenshots ?? []) {
      const bytes = statSync(path.join(process.cwd(), 'public', shot.src)).size;
      expect(bytes).toBeLessThan(300 * 1024);
    }
  });

  it('gives every shortcut an icon that exists, at the size the file really has', () => {
    for (const shortcut of m.shortcuts ?? []) {
      expect(shortcut.icons).toHaveLength(1);
      for (const icon of shortcut.icons ?? []) {
        const { width, height } = pngSize(
          path.join(process.cwd(), 'public', icon.src),
        );
        expect(icon.sizes).toBe(`${width}x${height}`);
        // web.dev: a single 192px icon is the size to ship when one has to do.
        expect(width).toBeGreaterThanOrEqual(96);
      }
    }
  });

  it('keeps a share target, if it has one, inside its scope', () => {
    expect((m.share_target?.action ?? m.scope!).startsWith(m.scope!)).toBe(
      true,
    );
  });

  it('starts inside its own scope', () => {
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
  });
});
