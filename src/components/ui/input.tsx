import {
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/components/ui/cn';
import {
  CHECKBOX,
  CHECK_LABEL,
  HINT,
  LABEL,
  fieldClass,
  textareaClass,
} from '@/components/ui/field';

/** A field's size, as `fieldClass` takes it. */
type Size = 'sm' | 'md';

/** A one-line text box. */
export function Input({
  size,
  className,
  ...props
}: Readonly<
  { size?: Size } & Omit<ComponentProps<'input'>, 'size'>
>): ReactElement {
  return <input className={fieldClass(className, size)} {...props} />;
}

/** A drop-down list of choices. */
export function Select({
  size,
  className,
  children,
  ...props
}: Readonly<
  { size?: Size } & Omit<ComponentProps<'select'>, 'size'>
>): ReactElement {
  return (
    <select className={fieldClass(cn('pr-8', className), size)} {...props}>
      {children}
    </select>
  );
}

/** A box for several lines of text. */
export function Textarea({
  className,
  ...props
}: Readonly<ComponentProps<'textarea'>>): ReactElement {
  return <textarea className={textareaClass(className)} {...props} />;
}

/**
 * A field with its label above and a line of help beneath. `children` is a
 * function given the id to put on the control, so the label points at it.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: Readonly<{
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}>): ReactElement {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="mt-1.5">{children(id)}</div>
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  );
}

/** A tick box with its words beside it. */
export function Checkbox({
  label,
  className,
  ...props
}: Readonly<
  { label: ReactNode } & Omit<ComponentProps<'input'>, 'type' | 'className'> & {
      className?: string;
    }
>): ReactElement {
  return (
    <label className={cn(CHECK_LABEL, className)}>
      <input type="checkbox" className={CHECKBOX} {...props} />
      {label}
    </label>
  );
}

/**
 * An on/off switch: a tick box drawn as a sliding knob, for a setting that
 * takes effect at once. It is still a checkbox to a screen reader (with the
 * switch role), so forms and keyboards treat it as one.
 */
export function Toggle({
  label,
  description,
  className,
  ...props
}: Readonly<
  {
    label: ReactNode;
    description?: ReactNode;
    className?: string;
  } & Omit<ComponentProps<'input'>, 'type' | 'className' | 'role'>
>): ReactElement {
  return (
    <label className={cn('flex items-start justify-between gap-4', className)}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-subtle">
            {description}
          </span>
        ) : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer focus-ring h-5 w-9 appearance-none rounded-full bg-ink/20 transition-colors checked:bg-accent hover:bg-ink/30 checked:hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-raised transition-transform peer-checked:translate-x-4"
        />
      </span>
    </label>
  );
}
