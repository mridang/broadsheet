import { cn } from '@/components/ui/cn';

/** The look of a text box or a select, with any extra layout classes. */
export function fieldClass(className?: string): string {
  return cn(
    'h-10 rounded-control border border-field bg-surface px-3 text-sm text-ink placeholder:text-subtle',
    'focus-ring-flush',
    className,
  );
}

/** A tick box's own look: the accent colour when ticked. */
export const CHECKBOX = 'size-4 rounded accent-accent focus-ring';

/** A tick box and its words, side by side. */
export const CHECK_LABEL = 'inline-flex items-center gap-2 text-sm text-ink';

/** A white panel with a hairline edge, which groups one thing on a page. */
export const CARD = 'rounded-card border border-line bg-surface';
