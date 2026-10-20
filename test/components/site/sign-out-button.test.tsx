import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { SignOutButton } from '../../../src/components/site/sign-out-button';
import { html } from '../render';

describe('SignOutButton', () => {
  it('is a button that looks like the masthead’s other account links', () => {
    expect(html(<SignOutButton />)).toBe(
      '<button type="button" class="navlink">Sign out</button>',
    );
  });
});

describe('signing out', () => {
  const assign = jest.fn();

  afterEach(() => {
    jest.restoreAllMocks();
    assign.mockClear();
    Reflect.deleteProperty(globalThis, 'window');
  });

  /** Click the button with a stand-in browser, and wait for it to finish. */
  async function click(fetchResult: Promise<Response>): Promise<jest.Mock> {
    const fetchSpy = jest.fn(() => fetchResult);
    Object.assign(globalThis, {
      window: { location: { assign } },
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy as never);
    const { props } = SignOutButton();
    await (props as { onClick: () => Promise<void> | void }).onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fetchSpy;
  }

  it('ends the session on the server, then goes to the front page', async () => {
    const fetchSpy = await click(
      Promise.resolve(new Response(null, { status: 204 })),
    );
    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/self', {
      method: 'DELETE',
    });
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('goes to the front page even when the request fails', async () => {
    await click(Promise.reject(new Error('offline')));
    expect(assign).toHaveBeenCalledWith('/');
  });
});
