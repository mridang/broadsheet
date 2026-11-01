import type { ArticleSummary } from '@/domain/repository';
import type { River } from '@/domain/rivers';
import {
  RiverPicker,
  UnpinRiverButton,
  type RiverOption,
} from '@/app/(site)/_components/river-controls';

/** A pinned river with its name and newest stories. */
export interface FilledRiver {
  readonly river: River;
  readonly label: string;
  readonly stories: readonly ArticleSummary[];
}

/** The rivers of one column. */
function Column({ rivers }: Readonly<{ rivers: readonly FilledRiver[] }>) {
  return rivers.map(({ river, label, stories }) => (
    <section key={river.id} aria-label={label}>
      <h2>{label}</h2>
      <ol>
        {stories.map((a) => (
          <li key={a.id}>
            <a href={`/article/${a.id}`}>{a.title ?? a.url}</a>
          </li>
        ))}
      </ol>
      <UnpinRiverButton id={river.id} />
    </section>
  ));
}

/**
 * The story lists the reader pinned to the left and right columns of their
 * front page, and the picker that pins another.
 */
export function Rivers({
  rivers,
  options,
}: Readonly<{
  rivers: readonly FilledRiver[];
  options: readonly RiverOption[];
}>) {
  const left = rivers.filter((r) => r.river.side === 'left');
  const right = rivers.filter((r) => r.river.side === 'right');
  return (
    <aside aria-label="Rivers">
      <div>
        <Column rivers={left} />
      </div>
      <div>
        <Column rivers={right} />
      </div>
      <RiverPicker
        options={options}
        next={{ left: left.length, right: right.length }}
      />
    </aside>
  );
}
