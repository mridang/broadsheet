import { formatEdition } from '@/domain/render/tiers';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icons';
import { MENU_ITEM, Menu } from '@/components/ui/menu';

/** The look of the previous- and next-day arrows. */
const ARROW = buttonClass({
  variant: 'outline',
  size: 'sm',
  className: 'w-9 border-line px-0',
});

/**
 * Date navigation at the top of the paper: page to the previous/next day's
 * issue (`/edition/{date}`), with a calendar dropdown listing the full archive
 * (all days kept).
 */
export function EditionBar({
  selected,
  editions,
}: {
  selected: string;
  editions: string[];
}) {
  const i = editions.indexOf(selected);
  const older = i >= 0 ? editions[i + 1] : undefined; // editions are newest-first
  const newer = i > 0 ? editions[i - 1] : undefined;

  return (
    <div className="flex items-center gap-2 print:hidden">
      {older ? (
        <a
          className={ARROW}
          href={`/edition/${older}`}
          aria-label="Previous day"
        >
          ‹
        </a>
      ) : (
        <span className={cn(ARROW, 'opacity-40')} aria-hidden="true">
          ‹
        </span>
      )}

      <span className="min-w-0 px-1 text-sm font-medium text-ink">
        {formatEdition(selected)}
      </span>

      {newer ? (
        <a className={ARROW} href={`/edition/${newer}`} aria-label="Next day">
          ›
        </a>
      ) : (
        <span className={cn(ARROW, 'opacity-40')} aria-hidden="true">
          ›
        </span>
      )}

      {editions.length > 1 && (
        <Menu
          label="Browse the archive"
          triggerClassName={ARROW}
          trigger={<Icon name="editions" className="size-4" />}
        >
          <ArchiveLinks editions={editions} selected={selected} />
        </Menu>
      )}
    </div>
  );
}

/** Every issue in the archive, newest first, the one showing marked. */
export function ArchiveLinks({
  editions,
  selected,
}: Readonly<{ editions: readonly string[]; selected: string }>) {
  return (
    <>
      {editions.map((d) => (
        <a
          key={d}
          href={`/edition/${d}`}
          aria-current={d === selected ? 'page' : undefined}
          className={cn(
            MENU_ITEM,
            'text-muted aria-[current=page]:bg-ink/[0.07] aria-[current=page]:font-semibold aria-[current=page]:text-ink',
          )}
        >
          {formatEdition(d)}
        </a>
      ))}
    </>
  );
}
