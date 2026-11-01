import type { ReactElement, ReactNode } from 'react';

/**
 * @packageDocumentation
 *
 * Model answers are written in Markdown (NewsBlur's assistant asks for it).
 * This renders the small part of it they use, as React elements, never as
 * HTML: paragraphs, `#` headings, `-`/`*`/`1.` lists, `**bold**`, `*italic*`,
 * `` `code` ``, links whose address is `http(s)` or a page of this app, and
 * the assistant's `[#id]` citations as links to `/article/{id}`. Anything
 * else stays text, so an answer can never inject markup.
 */

/** Whether a link may be followed: the web, or a path on this app. */
function safeHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^\/(?!\/)/.test(href);
}

/** The inline marks of one line of text, as elements. */
export function inline(text: string, keyPrefix = ''): ReactNode[] {
  const pattern =
    /\[#(\d+)\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}${n++}`;
    const [whole, cite, label, href, bold, em, code] = m;
    if (cite) {
      out.push(
        <a key={key} href={`/article/${cite}`} className="focus-ring">
          [{cite}]
        </a>,
      );
    } else if (label !== undefined && href !== undefined) {
      out.push(
        safeHref(href) ? (
          <a key={key} href={href} className="focus-ring">
            {label}
          </a>
        ) : (
          whole
        ),
      );
    } else if (bold) out.push(<strong key={key}>{bold}</strong>);
    else if (em) out.push(<em key={key}>{em}</em>);
    else if (code) out.push(<code key={key}>{code}</code>);
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One block of an answer. */
type Block =
  | { readonly kind: 'p' | 'h'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: string[] };

/** Split an answer into paragraphs, headings and lists. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const kind = bullet ? 'ul' : numbered ? 'ol' : undefined;
    const prev = out.at(-1);
    if (kind) {
      const item = (bullet ?? numbered)![1]!;
      if (prev && prev.kind === kind) prev.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (heading) out.push({ kind: 'h', text: heading[1]! });
    else out.push({ kind: 'p', text: line });
  }
  return out;
}

/** An answer written in Markdown, rendered safely. */
export function Markdown({
  text,
  className,
}: Readonly<{ text: string; className?: string }>): ReactElement {
  return (
    <div className={className}>
      {blocks(text).map((block, i) => {
        if (!('items' in block)) {
          if (block.kind === 'p') {
            return <p key={i}>{inline(block.text, `${i}-`)}</p>;
          }
          return (
            <p key={i} className="font-semibold">
              {inline(block.text, `${i}-`)}
            </p>
          );
        }
        const items = block.items.map((item, j) => (
          <li key={j}>{inline(item, `${i}-${j}-`)}</li>
        ));
        return block.kind === 'ul' ? (
          <ul key={i} className="list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={i} className="list-decimal pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
