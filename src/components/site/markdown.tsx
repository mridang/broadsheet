import type { ReactElement, ReactNode } from 'react';

const SAFE_HREF_PATTERN = /^https?:\/\//i;
const SAFE_HREF_PATTERN_2 = /^\/(?!\/)/;
const BLOCKS_PATTERN = /^[-*]\s+(\S.*)$/;
const BLOCKS_PATTERN_2 = /^\d+[.)]\s+(\S.*)$/;
const BLOCKS_PATTERN_3 = /^#{1,6}\s+(\S.*)$/;

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
  /\[#(\d+)\]/, // citation
  // eslint-disable-next-line sonarjs/super-linear-regex -- tried: a `[` with no `]` after it rescans the rest of the line, and no regex form or string method gives the same links without that scan; a line is short text and the run is cut at the first `]`
  /\[([^\]]+)\]\(([^)\s]+)\)/, // link
  /\*{2}([^*]+)\*{2}/, // bold
  /\*([^*\s][^*]*)\*/, // emphasis
  /`([^`]+)`/, // code
]
  .map((mark) => mark.source)
  .join('|');

/** The inline marks of one line of text, as elements. */
export function inline(text: string, keyPrefix = ''): ReactNode[] {
  const pattern = new RegExp(INLINE_MARKS, 'g');
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}${n}`;
    n += 1;
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
    else {
      // Every match is one of the forms above, so there is nothing more to emit.
    }
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
    const bullet = BLOCKS_PATTERN.exec(line);
    const numbered = BLOCKS_PATTERN_2.exec(line);
    const heading = BLOCKS_PATTERN_3.exec(line);
    const kind = bullet ? 'ul' : numbered && 'ol';
    const previous = out.at(-1);
    if (kind) {
      const item = (bullet ?? numbered)![1]!;
      if (previous && previous.kind === kind) previous.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (heading) out.push({ kind: 'h', text: heading[1]! });
    else out.push({ kind: 'p', text: line });
  }
  return out;
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
