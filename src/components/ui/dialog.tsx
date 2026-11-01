'use client';

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';

/**
 * A modal dialog over the page, drawn with the browser's own `<dialog>` (so
 * focus is held inside it and Escape closes it). It is shown while `open` is
 * true and calls `onClose` when the reader dismisses it. On a phone it rises
 * from the bottom as a sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** The dialog's buttons, along the bottom. */
  footer?: ReactNode;
  children?: ReactNode;
}>): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-card border border-line bg-surface p-0 text-ink shadow-overlay backdrop:bg-black/40 max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted">{description}</p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </IconButton>
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
