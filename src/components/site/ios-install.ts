/**
 * @packageDocumentation
 *
 * Whether to show the "Add to Home Screen" tip. Chrome and Edge fire
 * `beforeinstallprompt`, so the app can offer an Install button there; Safari on
 * iPhone and iPad has no such event and no install API at all, the only way is
 * the Share sheet. So the tip tells people where to tap, and only to the people
 * who can use it: Safari on an iOS device, not already running as the installed
 * app, and who have not waved it away.
 *
 * Telling Safari-on-iOS from everything else is the one place in the app that
 * has to read the user-agent string, because there is no feature to test for
 * ("can this browser add to the Home Screen from its Share sheet" is not
 * exposed). It lives here, alone and tested, so nothing else needs to guess.
 */

import { BRAND_NAME } from '@/app/_brand';

/** The `localStorage` key that remembers the tip was dismissed. */
export const IOS_HINT_STORAGE_KEY = `${BRAND_NAME}:ios-install-hint-dismissed`;

/**
 * The sentence the tip shows. The Share button is the square with an arrow in
 * Safari's toolbar; "Add to Home Screen" is a row in the sheet it opens.
 */
export const IOS_HINT_TEXT = 'Install: tap Share, then Add to Home Screen.';

/**
 * Browsers and apps on iOS that are not Safari. Every iOS browser is WebKit
 * underneath, and Chrome, Firefox, Edge and Opera say so in their user agents
 * with their own marker; apps with a built-in web view (social networks,
 * messengers, search apps) add theirs. None of these has Safari's Share sheet
 * in the same place, so the tip would send people looking for a button that is
 * not there.
 */
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|MicroMessenger|Pinterest|Slack|Telegram|WhatsApp/;

/** What the page can tell about the device and how it was opened. */
export type InstallEnvironment = Readonly<{
  /** `navigator.userAgent`. */
  userAgent: string;
  /**
   * `navigator.maxTouchPoints`. An iPad in its default "desktop website" mode
   * calls itself a Mac; the touch screen is what tells it apart from one.
   */
  maxTouchPoints: number;
  /** `navigator.standalone`: true inside an app added to the Home Screen. */
  standalone: boolean;
  /** `matchMedia('(display-mode: standalone)')`: the installed-app display mode. */
  displayModeStandalone: boolean;
  /** Whether the person already dismissed the tip. */
  dismissed: boolean;
}>;

/**
 * Whether the user agent is an iPhone, an iPod or an iPad. Since iPadOS 13 an
 * iPad asks for desktop websites by default and sends a Mac's user agent, so a
 * "Macintosh" that has a touch screen is an iPad too (no Mac has one).
 */
function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

/**
 * Whether this is Safari itself on an iOS device: an iOS device whose user agent
 * carries Safari's `Version/` and `Safari/` tokens and none of the markers of
 * another browser or an app's built-in web view.
 */
export function isIosSafari(
  userAgent: string,
  maxTouchPoints: number,
): boolean {
  return (
    isIosDevice(userAgent, maxTouchPoints) &&
    /Version\/[\d.]+/.test(userAgent) &&
    /Safari\//.test(userAgent) &&
    !NOT_SAFARI.test(userAgent)
  );
}

/**
 * Whether to show the Add to Home Screen tip: in Safari on iOS, when the page is
 * not already the installed app (either way of asking: iOS's own
 * `navigator.standalone`, and the standard display-mode query), and when the
 * tip has not been dismissed.
 */
export function shouldOfferIosInstall(env: InstallEnvironment): boolean {
  return (
    isIosSafari(env.userAgent, env.maxTouchPoints) &&
    !env.standalone &&
    !env.displayModeStandalone &&
    !env.dismissed
  );
}

/** The parts of the browser the tip reads, so a test can hand in stand-ins. */
export type InstallHost = Readonly<{
  navigator: Readonly<{ userAgent: string; maxTouchPoints: number }> &
    Readonly<{ standalone?: boolean }>;
  matchMedia: (query: string) => Readonly<{ matches: boolean }>;
  /** `localStorage`, which may be missing or throw (private windows, blocked storage). */
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
}>;

/**
 * Whether the person already dismissed the tip. Storage can be missing or throw
 * (private windows, blocked site data); then the tip simply shows each visit,
 * which is harmless.
 */
function wasDismissed(host: InstallHost): boolean {
  try {
    return host.storage()?.getItem(IOS_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Read the browser into the facts {@link shouldOfferIosInstall} decides from. */
export function readInstallEnvironment(host: InstallHost): InstallEnvironment {
  return {
    userAgent: host.navigator.userAgent,
    maxTouchPoints: host.navigator.maxTouchPoints,
    standalone: host.navigator.standalone === true,
    displayModeStandalone: host.matchMedia('(display-mode: standalone)')
      .matches,
    dismissed: wasDismissed(host),
  };
}

/** Remember that the tip was dismissed. Quietly does nothing where storage is unavailable. */
export function rememberDismissed(host: InstallHost): void {
  try {
    host.storage()?.setItem(IOS_HINT_STORAGE_KEY, '1');
  } catch {
    // Nothing to do: without storage the tip comes back next visit.
  }
}
