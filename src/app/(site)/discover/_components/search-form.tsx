import type { ReactElement } from 'react';

import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';

/** A Discover search: a plain GET back to the tab, so a search is a link. */
export function SearchForm({
  tab,
  query,
  label,
  placeholder,
}: Readonly<{
  tab: string;
  query: string;
  label: string;
  placeholder: string;
}>): ReactElement {
  return (
    <form
      className="mt-6 flex flex-col gap-2 sm:flex-row"
      action="/discover"
      method="get"
      role="search"
    >
      <input type="hidden" name="tab" value={tab} />
      <label htmlFor="discover-q" className="sr-only">
        {label}
      </label>
      <input
        id="discover-q"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={200}
        placeholder={placeholder}
        className={fieldClass('h-11 w-full text-base sm:flex-1')}
      />
      <button
        type="submit"
        className={buttonClass({ size: 'wide', className: 'h-11' })}
      >
        Search
      </button>
    </form>
  );
}
