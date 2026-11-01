import { describe, expect, it } from '@jest/globals';

import { Card, List, ListItem } from '@/components/ui/card';
import { classOf, html } from '../render';

describe('Card', () => {
  it('is a padded panel with a hairline edge', () => {
    const classes = classOf(html(<Card>x</Card>), 'div');
    expect(classes).toContain('rounded-card');
    expect(classes).toContain('border-line');
    expect(classes).toContain('p-5');
  });

  it('lifts under the pointer only when it is interactive', () => {
    expect(classOf(html(<Card>x</Card>), 'div')).not.toContain('hover:shadow');
    expect(classOf(html(<Card interactive>x</Card>), 'div')).toContain(
      'hover:shadow-raised',
    );
  });

  it('can be another element and drop its padding', () => {
    const out = html(
      <Card as="section" padding="none">
        x
      </Card>,
    );
    expect(classOf(out, 'section')).not.toContain('p-5');
  });
});

describe('ListItem', () => {
  it('shows a title, its detail and its actions', () => {
    const out = html(
      <List label="Feeds">
        <ListItem
          title="Hacker News"
          detail="20 stories"
          actions={<button>Go</button>}
        />
      </List>,
    );
    expect(out).toContain('aria-label="Feeds"');
    expect(out).toContain('Hacker News');
    expect(out).toContain('20 stories');
    expect(out).toContain('<button>Go</button>');
  });
});
