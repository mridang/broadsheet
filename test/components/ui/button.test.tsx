import { describe, expect, it } from '@jest/globals';

import {
  Button,
  buttonClass,
  ButtonLink,
  isServerHref,
} from '@/components/ui/button';
import { classOf, html } from '../render';

describe('buttonClass', () => {
  it('is the filled button of the middle size by default', () => {
    const classes = buttonClass({});
    expect(classes).toContain('bg-ink');
    expect(classes).toContain('h-10');
  });

  it('takes its colours from the variant and its height from the size', () => {
    expect(buttonClass({ variant: 'outline' })).toContain('border-field');
    expect(buttonClass({ variant: 'accent' })).toContain('bg-highlight');
    expect(buttonClass({ size: 'lg' })).toContain('h-12');
    expect(buttonClass({ size: 'sm' })).toContain('h-9');
  });

  it('has a wide size that is the middle size with roomier sides', () => {
    expect(buttonClass({ size: 'wide' })).toContain('h-10');
    expect(buttonClass({ size: 'wide' })).toContain('px-5');
    expect(buttonClass({ size: 'wide' })).not.toContain('px-4');
  });

  it('adds the caller’s own layout classes', () => {
    expect(buttonClass({ className: 'max-md:hidden' })).toContain(
      'max-md:hidden',
    );
  });
});

describe('Button', () => {
  it('never submits a form unless asked to', () => {
    expect(html(<Button>Go</Button>)).toContain('type="button"');
    expect(html(<Button type="submit">Go</Button>)).toContain('type="submit"');
  });

  it('can be disabled, and says so to assistive technology', () => {
    expect(html(<Button disabled>Go</Button>)).toContain('disabled');
  });

  it('wears the classes of its look', () => {
    expect(classOf(html(<Button variant="ghost">Go</Button>), 'button')).toBe(
      buttonClass({ variant: 'ghost' }),
    );
  });
});

describe('isServerHref', () => {
  it('is true only for our own API routes', () => {
    expect(isServerHref('/auth/login')).toBe(true);
    expect(isServerHref('/app')).toBe(false);
    expect(isServerHref('https://example.com/api/x')).toBe(false);
  });
});

describe('ButtonLink', () => {
  it('is a link that looks like a button', () => {
    const out = html(<ButtonLink href="/connect">Set it up</ButtonLink>);
    expect(out.startsWith('<a ')).toBe(true);
    expect(out).toContain('href="/connect"');
    expect(classOf(out, 'a')).toBe(buttonClass({}));
  });

  it('is a plain anchor for an API route, which the router cannot follow', () => {
    const out = html(<ButtonLink href="/auth/login">Sign in</ButtonLink>);
    expect(out).toBe(
      `<a href="/auth/login" class="${buttonClass({})}">Sign in</a>`,
    );
  });
});
