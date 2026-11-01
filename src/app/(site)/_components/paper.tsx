import type { Article } from '@/domain/repository';
import type { Layout } from '@/domain/render/layout';
import { Section, type Personal } from '@/app/(site)/_components/section';
import { LegalLinks } from '@/app/(site)/_components/legal-links';

/**
 * A laid-out paper: the editor's note when there is one, then each section's
 * desks under its heading (the unfiled ones lead with none), then the foot.
 */
export function Paper({
  layout,
  articles,
  briefing,
  personal,
}: {
  layout: Layout;
  articles: ReadonlyMap<number, Article>;
  briefing: string | null;
  personal?: Personal;
}) {
  return (
    <>
      {briefing ? (
        <aside
          className="mb-10 rounded-card border border-line bg-surface p-5 sm:p-6"
          aria-label="Editor's note"
        >
          <h2 className="text-xs font-semibold tracking-wide text-accent uppercase">
            Editor&rsquo;s note
          </h2>
          <p className="mt-2 leading-relaxed text-ink">{briefing}</p>
        </aside>
      ) : null}
      {layout.groups.map((group, i) => (
        <div key={group.name ?? `unfiled-${i}`} className="mt-14 first:mt-0">
          {group.name ? (
            <h2 className="mb-6 text-2xl font-semibold tracking-tight text-ink">
              {group.name}
            </h2>
          ) : null}
          {group.desks.map((desk) => (
            <Section
              key={desk.feed_id}
              desk={desk}
              articles={articles}
              personal={personal}
            />
          ))}
        </div>
      ))}
      <footer className="mt-16 border-t border-line pt-6 text-xs text-subtle">
        <p>
          The Hacker Times — auto-generated from your feeds, refreshed daily.
          Every day is archived.
        </p>
        <p className="mt-1 print:hidden">
          Generative layout: weight → tier → copyfit, with an In Brief list for
          the low-weight tail. The same story from several sources shows once.
        </p>
        <LegalLinks />
      </footer>
    </>
  );
}
