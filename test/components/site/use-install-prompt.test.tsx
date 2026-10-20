import { describe, expect, it, jest } from '@jest/globals';

import {
  isInstallPromptEvent,
  runInstall,
  useInstallPrompt,
} from '../../../src/components/site/use-install-prompt';
import { html } from '../render';

/** Says whether the hook offers an install action. */
function Probe() {
  const { install } = useInstallPrompt();
  return <p>{install ? 'can install' : 'cannot install'}</p>;
}

describe('useInstallPrompt', () => {
  it('offers nothing until the browser says the site can be installed', () => {
    expect(html(<Probe />)).toBe('<p>cannot install</p>');
  });
});

describe('isInstallPromptEvent', () => {
  it('recognises the event that carries a prompt method', () => {
    expect(
      isInstallPromptEvent(
        Object.assign(new Event('beforeinstallprompt'), {
          prompt: () => Promise.resolve(),
        }),
      ),
    ).toBe(true);
  });

  it('turns down any other event, so a stray one cannot be "installed"', () => {
    expect(isInstallPromptEvent(new Event('beforeinstallprompt'))).toBe(false);
    expect(
      isInstallPromptEvent(
        Object.assign(new Event('beforeinstallprompt'), { prompt: 'no' }),
      ),
    ).toBe(false);
  });
});

describe('runInstall', () => {
  it('shows the prompt, then waits for the person’s answer', async () => {
    const order: string[] = [];
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: jest.fn(async () => {
        order.push('prompt');
      }),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }).then(
        (choice) => {
          order.push('answer');
          return choice;
        },
      ),
    });
    await runInstall(event);
    expect(order).toEqual(['prompt', 'answer']);
  });
});
