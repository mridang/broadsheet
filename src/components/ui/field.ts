import { cn } from '@/components/ui/cn';

/** The height and type of each field size. */
const FIELD_SIZES = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-10 px-3 text-sm',
} as const;

/** The look of a text box or a select, with any extra layout classes. */
export function fieldClass(
  className?: string,
  size: keyof typeof FIELD_SIZES = 'md',
): string {
  return cn(
    'rounded-control border border-field bg-surface text-ink transition-colors placeholder:text-subtle hover:border-ink/70 disabled:cursor-not-allowed disabled:opacity-50',
    'focus-ring-flush',
    FIELD_SIZES[size],
    className,
  );
}

/** The look of a box for several lines of text. */
export function textareaClass(className?: string): string {
  return cn(
    'block w-full rounded-control border border-field bg-surface px-3 py-2 text-sm leading-relaxed text-ink transition-colors placeholder:text-subtle hover:border-ink/70',
    'focus-ring-flush',
    className,
  );
}

/** A tick box's own look: the accent colour when ticked. */
export const CHECKBOX = 'size-4 rounded-sm accent-accent focus-ring';

/** A tick box and its words, side by side. */
export const CHECK_LABEL = 'inline-flex items-center gap-2 text-sm text-ink';

/** The words above a field. */
export const LABEL = 'block text-sm font-medium text-ink';

/** A line of help beneath a field. */
export const HINT = 'mt-1.5 text-xs text-subtle';

/** A white panel with a hairline edge, which groups one thing on a page. */
export const CARD = 'rounded-card border border-line bg-surface';
