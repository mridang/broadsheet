import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Popover } from '@/components/ui/popover';

/**
 * A button that opens a floating panel: a menu of actions or a small form. It
 * is the shared {@link Popover}, so the open panel sits in the browser's top
 * layer, above every card and the sticky header, and Escape, a click outside
 * and choosing an item close it. `trigger` is the button's content and
 * `triggerClassName` its look (a `CHIP`, `buttonClass(...)`, an icon button);
 * the button carries `data-state="open"` while its panel shows.
 */
export function Menu({
  trigger,
  triggerClassName,
  label,
  width = 'w-56',
  className,
  children,
}: Readonly<{
  trigger: ReactNode;
  triggerClassName: string;
  /** The button's name for a screen reader, when it shows only an icon. */
  label?: string;
  /** The panel's width class. */
  width?: string;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <div className={className}>
      <Popover
        {...(label ? { label } : {})}
        button={trigger}
        buttonClassName={triggerClassName}
        panelClassName={cn(
          'max-h-[min(32rem,80dvh)] max-w-[calc(100vw-2rem)] overflow-y-auto shadow-overlay',
          width,
        )}
      >
        {children}
      </Popover>
    </div>
  );
}

/** The look of a quiet icon button that opens a menu, such as a story's "⋯". */
export const MENU_TRIGGER =
  'focus-ring inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10 data-[state=open]:bg-ink/5 data-[state=open]:text-ink';

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
