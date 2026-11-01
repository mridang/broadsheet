'use client';

import {
  useEffect,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/components/ui/cn';

/** Which edge of its button a menu lines up with. */
const ALIGN = {
  start: 'sm:left-0',
  end: 'sm:right-0',
} as const;

/**
 * A button that opens a floating panel: a menu of actions or a small form.
 * It is a `<details>`, so it works before the page's script has loaded; once
 * it has, Escape and a click elsewhere close it. On a phone the panel is a
 * sheet along the bottom of the screen. `trigger` is the button's content and
 * `triggerClassName` its look (a `CHIP`, `buttonClass(...)`, an icon button).
 */
export function Menu({
  trigger,
  triggerClassName,
  label,
  align = 'end',
  width = 'w-56',
  className,
  panelRef,
  children,
  ...summary
}: Readonly<
  {
    trigger: ReactNode;
    triggerClassName: string;
    /** The button's name for a screen reader, when it shows only an icon. */
    label?: string;
    align?: keyof typeof ALIGN;
    /** The panel's width class above phone size. */
    width?: string;
    className?: string;
    /** Lets the caller close the menu after an action. */
    panelRef?: React.RefObject<HTMLDetailsElement | null>;
    children: ReactNode;
  } & Omit<ComponentProps<'summary'>, 'className' | 'children'>
>): ReactElement {
  const own = useRef<HTMLDetailsElement>(null);
  const ref = panelRef ?? own;

  useEffect(() => {
    const close = (e: Event): void => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        el.open = false;
        el.querySelector('summary')?.focus();
        return;
      }
      if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [ref]);

  return (
    <details ref={ref} className={cn('group relative open:z-50', className)}>
      <summary
        aria-label={label}
        className={cn(
          'list-none [&::-webkit-details-marker]:hidden',
          triggerClassName,
        )}
        {...summary}
      >
        {trigger}
      </summary>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-card border border-line bg-surface p-1.5 shadow-overlay',
          'sm:absolute sm:inset-x-auto sm:bottom-auto sm:mt-1.5 sm:rounded-card',
          ALIGN[align],
          width,
          'max-sm:w-auto',
        )}
      >
        {children}
      </div>
    </details>
  );
}

/** The look of one row of a menu: a button or a link. */
export const MENU_ITEM =
  'focus-ring-flush flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-ink/5 active:bg-ink/10 aria-pressed:text-accent disabled:cursor-not-allowed disabled:opacity-50';

/** One action in a `Menu`. */
export function MenuItem({
  className,
  children,
  ...props
}: Readonly<ComponentProps<'button'>>): ReactElement {
  return (
    <button type="button" className={cn(MENU_ITEM, className)} {...props}>
      {children}
    </button>
  );
}

/** A hairline between groups of a `Menu`'s items. */
export function MenuDivider(): ReactElement {
  return <hr className="my-1.5 border-line" />;
}

/** A small caption above a group of a `Menu`'s items. */
export function MenuLabel({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <p className="px-3 pt-2 pb-1 text-label font-semibold text-subtle uppercase">
      {children}
    </p>
  );
}
