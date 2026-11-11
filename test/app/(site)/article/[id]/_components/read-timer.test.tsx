import { describe, expect, it } from '@jest/globals';

import {
  ReadTimer,
  readClock,
} from '@/app/(site)/article/[id]/_components/read-timer';
import { html } from '../../../../../components/render';

describe('ReadTimer', () => {
  it('renders nothing', () => {
    expect(html(<ReadTimer id={3} />)).toBe('');
  });
});

describe('readClock', () => {
  it('counts only the time the page was in view', () => {
    const clock = readClock(true, 0);
    expect(clock.hide(10_000)).toBe(10);
    clock.show(60_000);
    expect(clock.hide(75_400)).toBe(25);
  });

  it('counts nothing while hidden, and a second hide adds nothing', () => {
    const clock = readClock(false, 0);
    expect(clock.hide(5000)).toBe(0);
    clock.show(5000);
    clock.show(8000);
    expect(clock.hide(9000)).toBe(4);
    expect(clock.hide(20_000)).toBe(4);
  });
});
