import { describe, expect, it } from '@jest/globals';

import {
  IOS_HINT_STORAGE_KEY,
  isIosSafari,
  readInstallEnvironment,
  rememberDismissed,
  shouldOfferIosInstall,
  type InstallEnvironment,
  type InstallHost,
} from '@/components/site/ios-install';

/** Real user-agent strings, as the browsers send them. */
const AGENTS = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // Since iPadOS 13 an iPad asks for desktop sites by default and says "Macintosh".
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.87 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.20.114 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 123456789)',
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.0;FBBV/1;FBDV/iPhone14,5]',
  iphoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/320.0.0 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
} as const;

describe('isIosSafari', () => {
  it('is true for Safari on an iPhone and on an iPad', () => {
    expect(isIosSafari(AGENTS.iphoneSafari, 5)).toBe(true);
    expect(isIosSafari(AGENTS.ipadSafari, 5)).toBe(true);
  });

  it('is true for an iPad that calls itself a Mac, because it has a touch screen', () => {
    expect(isIosSafari(AGENTS.ipadAsMac, 5)).toBe(true);
  });

  it('is false for a real Mac, which has no touch screen', () => {
    expect(isIosSafari(AGENTS.macSafari, 0)).toBe(false);
  });

  it.each([
    ['Chrome', AGENTS.iphoneChrome],
    ['Firefox', AGENTS.iphoneFirefox],
    ['Edge', AGENTS.iphoneEdge],
    ['the Instagram app', AGENTS.iphoneInstagram],
    ['the Facebook app', AGENTS.iphoneFacebook],
    ['the Google app', AGENTS.iphoneGoogleApp],
  ])(
    'is false for %s on an iPhone, which has no Share sheet to point at',
    (_, agent) => {
      expect(isIosSafari(agent, 5)).toBe(false);
    },
  );

  it('is false for browsers that are not on iOS at all', () => {
    expect(isIosSafari(AGENTS.androidChrome, 5)).toBe(false);
    expect(isIosSafari(AGENTS.macChrome, 0)).toBe(false);
    expect(isIosSafari('', 0)).toBe(false);
  });
});

describe('shouldOfferIosInstall', () => {
  const base: InstallEnvironment = {
    userAgent: AGENTS.iphoneSafari,
    maxTouchPoints: 5,
    standalone: false,
    displayModeStandalone: false,
    dismissed: false,
  };

  it('offers the tip in plain Safari on an iPhone', () => {
    expect(shouldOfferIosInstall(base)).toBe(true);
  });

  it('never offers it inside the installed app, whichever way that is told', () => {
    expect(shouldOfferIosInstall({ ...base, standalone: true })).toBe(false);
    expect(
      shouldOfferIosInstall({ ...base, displayModeStandalone: true }),
    ).toBe(false);
  });

  it('stops offering it once dismissed', () => {
    expect(shouldOfferIosInstall({ ...base, dismissed: true })).toBe(false);
  });

  it('does not offer it in other browsers', () => {
    expect(
      shouldOfferIosInstall({ ...base, userAgent: AGENTS.iphoneChrome }),
    ).toBe(false);
  });
});

/** A browser stand-in: the user agent, the display mode, and what storage holds. */
function host(
  options: Readonly<{
    standalone?: boolean;
    displayMode?: boolean;
    stored?: Readonly<Record<string, string>>;
    storage?: InstallHost['storage'];
  }> = {},
): InstallHost {
  const store = new Map(Object.entries(options.stored ?? {}));
  return {
    navigator: {
      userAgent: AGENTS.iphoneSafari,
      maxTouchPoints: 5,
      ...(options.standalone === undefined
        ? {}
        : { standalone: options.standalone }),
    },
    matchMedia: (query) => ({
      matches: query === '(display-mode: standalone)' && !!options.displayMode,
    }),
    storage:
      options.storage ??
      (() => ({
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
      })),
  };
}

describe('readInstallEnvironment', () => {
  it('reads the user agent, touch points and both standalone signals', () => {
    expect(
      readInstallEnvironment(host({ standalone: true, displayMode: true })),
    ).toEqual({
      userAgent: AGENTS.iphoneSafari,
      maxTouchPoints: 5,
      standalone: true,
      displayModeStandalone: true,
      dismissed: false,
    });
  });

  it('treats a missing navigator.standalone (every browser but iOS) as not installed', () => {
    expect(readInstallEnvironment(host()).standalone).toBe(false);
  });

  it('reads a remembered dismissal', () => {
    expect(
      readInstallEnvironment(host({ stored: { [IOS_HINT_STORAGE_KEY]: '1' } }))
        .dismissed,
    ).toBe(true);
  });

  it('carries on when storage is missing or throws', () => {
    expect(
      readInstallEnvironment(host({ storage: () => undefined })).dismissed,
    ).toBe(false);
    expect(
      readInstallEnvironment(
        host({
          storage: () => {
            throw new Error('blocked');
          },
        }),
      ).dismissed,
    ).toBe(false);
  });
});

describe('rememberDismissed', () => {
  it('stores the dismissal where readInstallEnvironment finds it', () => {
    const stored = new Map<string, string>();
    const shared = host({
      storage: () => ({
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
      }),
    });
    rememberDismissed(shared);
    expect(readInstallEnvironment(shared).dismissed).toBe(true);
  });

  it('does nothing, without complaint, where storage is unavailable', () => {
    expect(() =>
      rememberDismissed(host({ storage: () => undefined })),
    ).not.toThrow();
    expect(() =>
      rememberDismissed(
        host({
          storage: () => {
            throw new Error('blocked');
          },
        }),
      ),
    ).not.toThrow();
  });
});
