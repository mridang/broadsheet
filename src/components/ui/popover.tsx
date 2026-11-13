'use client';

import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/components/ui/cn';

/**
 * Whether focus has moved out of a popover to somewhere else on the page.
 *
 * A keyboard user who tabs past the last item (or back past the button) has
 * left the panel, which must not stay open behind them. Focus going nowhere
 * (`next` is null: the window lost focus, or a click landed on something that
 * cannot take focus) is not leaving; a click outside is handled separately.
 * @param root - The popover's outer element (button and panel together).
 * @param next - The element receiving focus, if there is one.
 */
export function focusLeft(
  root: Pick<Node, 'contains'>,
  next: Node | null,
): boolean {
  return next !== null && !root.contains(next);
}

/**
 * The handler for key presses while a popover is open: Escape closes it and
 * puts focus back on its button (otherwise focus would be left on an item that
 * has just disappeared). Other keys are left to whatever has focus.
 * @param close - Closes the panel.
 * @param focusButton - Moves focus back to the popover's button.
 */
export function escapeHandler(
  close: () => void,
  focusButton: () => void,
): (event: Readonly<Pick<KeyboardEvent, 'key'>>) => void {
  return (event) => {
    if (event.key === 'Escape') {
      close();
      focusButton();
    }
  };
}

/** Where a popover was opened: the page's path at that moment. */
type OpenedOn = Readonly<{ pathname: string | null }>;

/**
 * Whether a popover that was opened on `openedOn` is still open on the page at
 * `pathname`. Navigating (a link elsewhere, the back button) puts the person on
 * a different page, and a panel left floating over it would be a stranger there.
 * Deriving this from the path means no effect has to notice the navigation.
 * @param openedOn - Where it was opened, or `null` if it is closed.
 * @param pathname - The path of the page being shown now.
 */
export function isOpenOn(
  openedOn: OpenedOn | null,
  pathname: string | null,
): boolean {
  return openedOn !== null && openedOn.pathname === pathname;
}

/** Where a popover's panel goes when the browser cannot place it: in pixels from the window's top and right edge. */
type Placement = Readonly<{ top: number; right: number }>;

/**
 * Whether this browser has the Popover API (Chrome 114, Firefox 125, Safari 17).
 * Where it has not, the panel is an ordinary box that the component shows and
 * hides itself, and the `popover` attribute does nothing.
 * @param panel - Any element; the API is looked for on it.
 */
export function supportsPopover(panel: object): boolean {
  return 'popover' in panel;
}

/**
 * Whether this browser can anchor a panel to its button in CSS (`position-area`:
 * Chrome 125, Safari 26, Firefox 147). The same test the stylesheet makes with
 * `@supports`, so that the script steps in exactly when the stylesheet does not.
 * @param css - The `CSS` namespace (or anything with its `supports`).
 */
export function supportsAnchorPositioning(
  css: Readonly<{
    supports: (property: string, value: string) => boolean;
  }>,
): boolean {
  return css.supports('position-area', 'bottom');
}

/**
 * Where to put a popover's panel in a browser that has popovers but cannot
 * anchor one to its button (before Safari 26 and Firefox 147): just under the
 * button, with the panel's right edge on the button's, like the anchored
 * layout. A button too near the window's right edge still leaves a margin.
 * @param button - The button's box, from `getBoundingClientRect()`.
 * @param viewportWidth - The window's width, without a scrollbar.
 */
export function fallbackPlacement(
  button: Readonly<Pick<DOMRect, 'bottom' | 'right'>>,
  viewportWidth: number,
): Placement {
  const margin = 8;
  return {
    top: button.bottom + margin,
    right: Math.max(margin, viewportWidth - button.right),
  };
}

/**
 * Hand a panel its {@link Placement} as two custom properties that the
 * stylesheet reads (`--popover-top`, `--popover-right`). Going through the style
 * object is allowed by the content security policy, which refuses an inline
 * `style` attribute.
 */
export function applyPlacement(
  style: Pick<CSSStyleDeclaration, 'setProperty'>,
  place: Placement,
): void {
  style.setProperty('--popover-top', `${place.top}px`);
  style.setProperty('--popover-right', `${place.right}px`);
}

/**
 * In a browser that cannot anchor the panel to its button in CSS, work out where
 * it goes from the button's box and hand that to the stylesheet. Does nothing
 * where the stylesheet can do it itself.
 */
function placeWithoutAnchors(
  panel: HTMLElement | null,
  trigger: Element | null,
): void {
  if (!panel || !trigger || supportsAnchorPositioning(CSS)) {
    return;
  }
  const width = document.documentElement.clientWidth;
  applyPlacement(
    panel.style,
    fallbackPlacement(trigger.getBoundingClientRect(), width),
  );
}

/** A store that never changes: all `useHydrated` needs is its two snapshots. */
const NO_STORE = (): (() => void) => () => undefined;

/**
 * Whether the page has been hydrated, that is, whether React has taken over the
 * markup the server sent. False on the server and during the first client
 * render, true afterwards.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    NO_STORE,
    () => true,
    () => false,
  );
}

/**
 * A button that opens a small panel of links and actions (the account menu and
 * the phone navigation), built on the browser's own Popover API. It is a
 * disclosure, not an ARIA "menu": the button says whether the panel is open, and
 * the panel is an ordinary list that Tab moves through.
 *
 * The browser does the work: the button opens and closes the panel with no
 * script (`popovertarget`), Escape and a click outside close it, focus goes back
 * to the button when it closes, and the open panel sits in the top layer, above
 * the sticky header. CSS places it under the button, lined up with its right
 * edge (see `globals.css`, which also says what happens in browsers without
 * anchor positioning or without popovers). What is left here is what the
 * browser does not do: it keeps the panel's contents out of the page until it
 * is opened (so a closed menu costs nothing and is not read out twice); it closes the panel when focus tabs out of it, when
 * anything inside it is chosen, and when the page navigates (the back button,
 * say); and it keeps `aria-expanded` and `data-state` in step with the panel.
 *
 * As a disclosure, opening it leaves focus on the button: the panel follows the
 * button in the page, so the next Tab enters it.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  panelClassName,
  children,
}: Readonly<{
  /** The button's accessible name when `button` is just an icon. */
  label?: string;
  /** What the button shows. */
  button: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  children: ReactNode;
}>): ReactElement {
  const pathname = usePathname();
  const hydrated = useHydrated();
  // Remember which page it was opened on: a different page means it is closed.
  const [openedOn, setOpenedOn] = useState<OpenedOn | null>(null);
  const open = isOpenOn(openedOn, pathname);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Hide the panel, however this browser shows it. In a browser with popovers
  // that is `hidePopover()` (which does nothing if it is already hidden), and
  // the panel's `toggle` event then updates the state; without them the state
  // is all there is.
  const close = useCallback(() => {
    const element = panel.current;
    if (element && supportsPopover(element)) {
      element.hidePopover();
    } else {
      setOpenedOn(null);
    }
  }, []);

  // The panel can be left open by a navigation that the browser knows nothing
  // about (a client-side route change): `open` has gone false by itself, so
  // bring the panel into step with it.
  useEffect(() => {
    if (!open) {
      close();
    }
  }, [open, close]);

  // Two listeners for what the browser does not do. Choosing a link or an
  // action inside the panel closes it: this runs after the item's own handler
  // (the click bubbles up to the panel), and closing does not stop a link being
  // followed. And in a browser with no popovers, where nothing else would,
  // Escape closes the panel and puts focus back on the button.
  useEffect(() => {
    const panelElement = panel.current;
    const rootElement = root.current;
    if (!panelElement || !rootElement) {
      return undefined;
    }
    const onPanelClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('a, button')
      ) {
        close();
      }
    };
    const onKeyDown = escapeHandler(close, () => trigger.current?.focus());
    panelElement.addEventListener('click', onPanelClick);
    if (!supportsPopover(panelElement)) {
      rootElement.addEventListener('keydown', onKeyDown);
    }
    return () => {
      panelElement.removeEventListener('click', onPanelClick);
      rootElement.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (focusLeft(event.currentTarget, event.relatedTarget)) {
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        // Wired up only once React is listening. Before that the browser would
        // open an empty panel (its contents are mounted when it opens), which
        // the page would then have to close again.
        popoverTarget={hydrated ? panelId : undefined}
        onClick={() => {
          // With popovers the browser has already toggled it; without, do it.
          if (panel.current && !supportsPopover(panel.current)) {
            setOpenedOn(open ? null : { pathname });
          }
        }}
        data-state={open ? 'open' : 'closed'}
        className={buttonClassName}
      >
        {button}
      </button>
      <div
        id={panelId}
        ref={panel}
        popover="auto"
        data-popover=""
        data-open={open ? '' : undefined}
        onBeforeToggle={(event) => {
          // About to open: mount the contents now, in the same tick, so the
          // panel is never drawn empty. Closing is told apart in `onToggle`,
          // after the browser has put focus back on the button; unmounting the
          // focused item first would leave focus nowhere.
          if (event.nativeEvent.newState === 'open') {
            setOpenedOn({ pathname });
            placeWithoutAnchors(panel.current, trigger.current);
          }
        }}
        onToggle={(event) => {
          if (event.nativeEvent.newState === 'closed') {
            setOpenedOn(null);
          }
        }}
        className={cn(
          'min-w-56 rounded-card border border-line bg-surface p-1.5 text-ink',
          panelClassName,
        )}
      >
        {open ? children : null}
      </div>
    </div>
  );
}

/** The class list for one row in a popover panel; style a link or a button with it. */
export const POPOVER_ITEM =
  'flex h-10 w-full cursor-pointer items-center gap-3 rounded-control px-3 text-left text-sm font-medium transition hover:bg-ink/5 disabled:opacity-50 focus-ring-flush';

/**
 * A line of status in a popover panel that is not something to press (for
 * instance "Google Drive connected"). It is plain text rather than a disabled
 * button, which would be skipped by Tab but still announced as "unavailable".
 */
export function PopoverStatus({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <p
      role="status"
      className="flex h-10 items-center gap-3 px-3 text-sm font-medium text-muted"
    >
      {children}
    </p>
  );
}

/** A thin rule between groups of items in a popover panel. */
export function PopoverSeparator(): ReactElement {
  return <div className="my-1.5 h-px bg-ink/10" role="separator" />;
}

/** A small, non-interactive caption in a popover panel (who is signed in, say). */
export function PopoverLabel({
  caption,
  children,
}: Readonly<{
  /** The small grey line above the value ("Signed in as"). */
  caption: string;
  /** The value itself, kept to one line. */
  children: ReactNode;
}>): ReactElement {
  return (
    <div className="px-3 py-2 text-sm">
      <span className="block text-xs text-subtle">{caption}</span>
      <span className="block truncate font-semibold">{children}</span>
    </div>
  );
}
