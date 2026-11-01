import { describe, expect, it } from '@jest/globals';

import {
  MAX_UPLOAD_LENGTH,
  iconResource,
  isAutoMarkReadDays,
  parseIcon,
} from '@/domain/api/icon-resource';

describe('parseIcon', () => {
  it.each([
    [
      { type: 'emoji', data: '📰' },
      { type: 'emoji', data: '📰' },
    ],
    [
      { type: 'preset', data: 'newspaper', color: '#FF5722' },
      { type: 'preset', data: 'newspaper', color: '#ff5722', set: 'lucide' },
    ],
    [
      { type: 'preset', data: 'bolt', set: 'heroicons-solid' },
      { type: 'preset', data: 'bolt', set: 'heroicons-solid' },
    ],
    [
      { type: 'upload', data: 'data:image/png;base64,iVBORw0KGgo=' },
      { type: 'upload', data: 'data:image/png;base64,iVBORw0KGgo=' },
    ],
  ])('accepts %j', (raw, icon) => {
    expect(parseIcon(raw, 'icon')).toEqual({ ok: true, icon });
  });

  it('accepts null, clearing the icon', () => {
    expect(parseIcon(null, 'icon')).toEqual({ ok: true, icon: null });
  });

  it.each([
    ['nope', 'icon: must be an object or null.'],
    [[], 'icon: must be an object or null.'],
    [
      { type: 'gif', data: 'x' },
      'icon.type: must be one of emoji, preset, upload.',
    ],
    [{ type: 'emoji' }, 'icon.data: required.'],
    [
      { type: 'emoji', data: '123456789' },
      'icon.data: an emoji, at most 8 characters.',
    ],
    [
      { type: 'preset', data: 'Bad Name' },
      'icon.data: an icon name of lowercase letters, digits and hyphens.',
    ],
    [
      { type: 'upload', data: 'https://x.test/i.png' },
      `icon.data: a data:image/png;base64 URL of at most ${MAX_UPLOAD_LENGTH} characters.`,
    ],
    [
      {
        type: 'upload',
        data: `data:image/png;base64,${'A'.repeat(MAX_UPLOAD_LENGTH)}`,
      },
      `icon.data: a data:image/png;base64 URL of at most ${MAX_UPLOAD_LENGTH} characters.`,
    ],
    [
      { type: 'emoji', data: '📰', color: 'red' },
      'icon.color: a hex colour such as #ff5722.',
    ],
    [
      { type: 'emoji', data: '📰', set: 'lucide' },
      'icon.set: only for a preset icon, one of lucide, heroicons-solid.',
    ],
    [
      { type: 'emoji', data: '📰', size: 3 },
      'icon.size: not a member of an icon.',
    ],
  ])('refuses %j, naming the field', (raw, error) => {
    expect(parseIcon(raw, 'icon')).toEqual({ ok: false, errors: [error] });
  });
});

describe('iconResource', () => {
  it('reads a stored icon back', () => {
    expect(iconResource('{"type":"emoji","data":"📰"}')).toEqual({
      type: 'emoji',
      data: '📰',
    });
  });

  it.each([null, '', 'not json', '{"type":"gif"}'])(
    'shows no icon for %j',
    (stored) => {
      expect(iconResource(stored)).toBeUndefined();
    },
  );
});

describe('isAutoMarkReadDays', () => {
  it.each([0, 1, 365])('accepts %j', (days) => {
    expect(isAutoMarkReadDays(days)).toBe(true);
  });

  it.each([-1, 366, 1.5, '7', null])('refuses %j', (days) => {
    expect(isAutoMarkReadDays(days)).toBe(false);
  });
});
