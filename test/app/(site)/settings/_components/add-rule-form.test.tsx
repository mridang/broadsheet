import { describe, expect, it } from '@jest/globals';

import { ruleRequest } from '@/app/(site)/settings/_components/add-rule-form';

/** A filled-in rule form. */
function form(fields: Record<string, string>, channels: readonly string[]) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  for (const channel of channels) data.append('channels', channel);
  return data;
}

describe('ruleRequest', () => {
  it.each([
    [
      { kind: 'title', value: 'rust', where: 'all' },
      ['web'],
      {
        kind: 'title',
        value: 'rust',
        is_regex: false,
        scope: 'all',
        channels: ['web'],
      },
    ],
    [
      { kind: 'url', value: '^a', is_regex: 'on', where: 'feed:3' },
      ['email', 'webhook'],
      {
        kind: 'url',
        value: '^a',
        is_regex: true,
        scope: 'feed',
        feed_id: '3',
        channels: ['email', 'webhook'],
      },
    ],
    [
      { kind: 'tag', value: 'go', where: 'section:2' },
      [],
      {
        kind: 'tag',
        value: 'go',
        is_regex: false,
        scope: 'section',
        section_id: '2',
        channels: [],
      },
    ],
  ])('turns %j into a rule', (fields, channels, request) => {
    expect(ruleRequest(form(fields, channels))).toEqual(request);
  });
});
