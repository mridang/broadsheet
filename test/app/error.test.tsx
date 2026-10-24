import { describe, expect, it } from '@jest/globals';

import { ERROR_REASSURANCE } from '@/app/_brand';
import ErrorPage from '@/app/error';
import { html } from '../components/render';

describe('ErrorPage', () => {
  const retry = () => undefined;

  it('says something went wrong, as the page’s heading', () => {
    const out = html(
      <ErrorPage error={new Error('boom')} unstable_retry={retry} />,
    );
    expect(out).toMatch(/<h1[^>]*>That didn&#x27;t work<\/h1>/);
    expect(out).toContain(ERROR_REASSURANCE);
  });

  it('offers to try again, and a way home', () => {
    const out = html(
      <ErrorPage error={new Error('boom')} unstable_retry={retry} />,
    );
    expect(out).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(out).toMatch(/<a [^>]*href="\/"[^>]*>Back to the home page<\/a>/);
  });

  it('does not show the error’s message, which may say more than it should', () => {
    const out = html(
      <ErrorPage error={new Error('secret detail')} unstable_retry={retry} />,
    );
    expect(out).not.toContain('secret detail');
  });

  it('quotes the digest, so the failure can be found in the server logs', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const out = html(<ErrorPage error={error} unstable_retry={retry} />);
    expect(out).toContain('Reference: abc123');
  });

  it('has no reference line when there is no digest', () => {
    const out = html(
      <ErrorPage error={new Error('boom')} unstable_retry={retry} />,
    );
    expect(out).not.toContain('Reference');
  });
});
