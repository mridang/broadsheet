import { describe, expect, it } from '@jest/globals';

import { TopicPicker } from '@/app/(site)/_components/topic-picker';
import { TOPICS } from '@/domain/topics';
import { html } from '../../../components/render';

describe('TopicPicker', () => {
  it('offers a checkbox per topic with its starter feeds', () => {
    const out = html(<TopicPicker topics={TOPICS} />);
    expect(out.match(/type="checkbox"/g)).toHaveLength(TOPICS.length);
    expect(out).toContain('value="technology"');
    expect(out).toContain('Hacker News');
    expect(out).toContain('Start my paper');
  });
});
