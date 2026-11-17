import type { ReactElement, ReactNode } from 'react';

const SAFE_HREF_PATTERN = /^https?:\/\//iu;
const SAFE_HREF_PATTERN_2 = /^\/(?!\/)/u;
const BLOCKS_PATTERN = /^[-*]\s+(\S.*)$/u;
const BLOCKS_PATTERN_2 = /^\d+[.)]\s+(\S.*)$/u;
const BLOCKS_PATTERN_3 = /^#{1,6}\s+(\S.*)$/u;

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
  return SAFE_HREF_PATTERN.test(href) || SAFE_HREF_PATTERN_2.test(href);
}

/** The inline marks, one alternative each, in the order they are tried. */
export const INLINE_MARKS = [
  /\[#(\d+)\]/u, // citation
  // eslint-disable-next-line sonarjs/super-linear-regex -- tried: a `[` with no `]` after it rescans the rest of the line, and no regex form or string method gives the same links without that scan; a line is short text and the run is cut at the first `]`
  /\[([^\]]+)\]\(([^)\s]+)\)/u, // link
  /\*{2}([^*]+)\*{2}/u, // bold
  /\*([^*\s][^*]*)\*/u, // emphasis
  /`([^`]+)`/u, // code
]
  .map((mark) => mark.source)
  .join('|');

/** The inline marks of one line of text, as elements. */
export function inline(text: string, keyPrefix = ''): ReactNode[] {
  const pattern = new RegExp(INLINE_MARKS, 'gu');
  const matches = [...text.matchAll(pattern)];
  const end = (m: RegExpExecArray | undefined): number =>
    m ? m.index + m[0].length : 0;
  const parts = matches.flatMap((m, n): ReactNode[] => {
    const gap =
      m.index > end(matches[n - 1])
        ? [text.slice(end(matches[n - 1]), m.index)]
        : [];
    const key = `${keyPrefix}${n}`;
    const [whole, cite, label, href, bold, em, code] = m;
    if (cite) {
      return [
        ...gap,
        <a key={key} href={`/article/${cite}`} className="focus-ring">
          [{cite}]
        </a>,
      ];
    }
    if (label !== undefined && href !== undefined) {
      return [
        ...gap,
        safeHref(href) ? (
          <a key={key} href={href} className="focus-ring">
            {label}
          </a>
        ) : (
          whole
        ),
      ];
    }
    if (bold) {
      return [...gap, <strong key={key}>{bold}</strong>];
    }
    if (em) {
      return [...gap, <em key={key}>{em}</em>];
    }
    if (code) {
      return [...gap, <code key={key}>{code}</code>];
    }
    // Every match is one of the forms above, so there is nothing more to emit.
    return gap;
  });
  const last = end(matches.at(-1));
  return last < text.length ? [...parts, text.slice(last)] : parts;
}

/** One block of an answer. */
type Block =
  | { readonly kind: 'p' | 'h'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: string[] };

/** Split an answer into paragraphs, headings and lists. */
export function blocks(markdown: string): Block[] {
  const lines = markdown
    .split('\n')
    .map((raw) => raw.trim())
    .filter((line) => line !== '')
    .map(
      (
        line,
      ):
        | { readonly kind: 'ul' | 'ol'; readonly item: string }
        | { readonly kind: 'p' | 'h'; readonly text: string } => {
        const bullet = BLOCKS_PATTERN.exec(line);
        const numbered = BLOCKS_PATTERN_2.exec(line);
        const heading = BLOCKS_PATTERN_3.exec(line);
        const kind = bullet ? 'ul' : numbered && 'ol';
        if (kind) {
          return { kind, item: (bullet ?? numbered)![1]! };
        }
        return heading
          ? { kind: 'h', text: heading[1]! }
          : { kind: 'p', text: line };
      },
    );
  return lines.flatMap((entry, index): Block[] => {
    if (!('item' in entry)) {
      return [entry];
    }
    if (lines[index - 1]?.kind === entry.kind) {
      return [];
    }
    const rest = lines.slice(index);
    const length = rest.findIndex((other) => other.kind !== entry.kind);
    const run = length === -1 ? rest : rest.slice(0, length);
    return [
      {
        kind: entry.kind,
        items: run.flatMap((other) => ('item' in other ? [other.item] : [])),
      },
    ];
  });
}

/** An answer written in Markdown, rendered safely. */
export function Markdown({
  text,
  // eslint-disable-next-line unicorn/no-keyword-prefix -- className is the React DOM prop name, fixed by the JSX API
  className,
  // eslint-disable-next-line unicorn/no-keyword-prefix -- className is the React DOM prop name, fixed by the JSX API
}: Readonly<{ text: string; className?: string }>): ReactElement {
  return (
    // eslint-disable-next-line unicorn/no-keyword-prefix -- className is the React DOM prop name, fixed by the JSX API
    <div className={className}>
      {blocks(text).map((block, index) => {
        if (!('items' in block)) {
          if (block.kind === 'p') {
            return <p key={index}>{inline(block.text, `${index}-`)}</p>;
          }
          return (
            <p key={index} className="font-semibold">
              {inline(block.text, `${index}-`)}
            </p>
          );
        }
        const items = block.items.map((item, index2) => (
          <li key={index2}>{inline(item, `${index}-${index2}-`)}</li>
        ));
        return block.kind === 'ul' ? (
          <ul key={index} className="list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={index} className="list-decimal pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
