import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** A component's HTML, for asserting on what it renders (there is no DOM in these tests). */
export function html(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** The pieces of the app router a component might call; each does nothing. */
const STILL_ROUTER = Object.freeze({
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  // Next 16.4 lets a form key itself on this so it resets with the page.
  bfcacheId: 'test',
});

/**
 * A component's HTML as it would render inside the app, for one that reads the
 * router (`useRouter`, `usePathname`, `useSearchParams`) and would otherwise
 * throw. The router never navigates; `pathname` and `search` say where it is.
 */
export function htmlAt(
  element: ReactElement,
  location: Readonly<{ pathname?: string; search?: string }> = {},
): string {
  const { pathname = '/', search = '' } = location;
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STILL_ROUTER },
      createElement(
        PathnameContext.Provider,
        { value: pathname },
        createElement(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(search) as never },
          element,
        ),
      ),
    ),
  );
}

/** The class list of the first element whose tag is `tag`. */
export function classOf(markup: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(markup)?.[1] ?? '';
}
