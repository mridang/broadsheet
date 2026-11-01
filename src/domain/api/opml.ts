/**
 * @packageDocumentation
 *
 * OPML on the wire: the subscription list a person exports from, or imports
 * into, a feed reader. Parsing is a small tolerant scan of `<outline>` tags
 * (Workers have no DOM); a document that declares entities is refused.
 */

/** Media type of an OPML document. */
export const OPML_TYPE = 'text/x-opml';

/** A feed found in an OPML document, with the folder it sat under. */
export interface OpmlFeed {
  readonly url: string;
  readonly title?: string;
  readonly section?: string;
}

/** The feeds of an OPML document, or why it could not be read. */
export type OpmlParse =
  | { readonly ok: true; readonly feeds: readonly OpmlFeed[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Escape text for an XML attribute value. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

function attributes(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    found.set((m[1] ?? '').toLowerCase(), unescapeXml(m[3] ?? m[4] ?? ''));
  }
  return found;
}

/** The index just past the `>` that ends the tag at `from`, or -1. */
function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return -1;
}

/** Where a comment, CDATA section or processing instruction at `at` ends. */
function skipMarkup(text: string, at: number): number | undefined {
  for (const [open, close] of [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
  ] as const) {
    if (text.startsWith(open, at)) {
      const end = text.indexOf(close, at + open.length);
      return end < 0 ? -1 : end + close.length;
    }
  }
  return undefined;
}

/**
 * Read the feeds out of an OPML document; folders become sections. One pass
 * over the text, so a hostile file costs no more than its length. Comments
 * are skipped, and `>` inside a quoted attribute does not end a tag.
 */
export function parseOpml(text: string): OpmlParse {
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) {
    return { ok: false, errors: ['body: DOCTYPE and ENTITY are not allowed.'] };
  }
  if (!/<opml[\s>]/i.test(text)) {
    return { ok: false, errors: ['body: not an OPML document.'] };
  }
  const feeds: OpmlFeed[] = [];
  const folders: string[] = [];
  // Whether each open outline pushed a folder name, so a close can pop it.
  const open: boolean[] = [];
  let at = text.indexOf('<');
  while (at >= 0) {
    const skipped = skipMarkup(text, at);
    if (skipped === -1) {
      return { ok: false, errors: ['body: not well formed.'] };
    }
    if (skipped !== undefined) {
      at = text.indexOf('<', skipped);
      continue;
    }
    if (/^<\/outline\s*>/i.test(text.slice(at, at + 16))) {
      if (open.pop()) folders.pop();
    } else if (/^<outline[\s/>]/i.test(text.slice(at, at + 9))) {
      const end = tagEnd(text, at + 8);
      if (end < 0) {
        return { ok: false, errors: ['body: not well formed.'] };
      }
      const tag = text.slice(at + 8, end - 1);
      const attrs = attributes(tag);
      const url = attrs.get('xmlurl')?.trim();
      const label = (attrs.get('text') ?? attrs.get('title') ?? '').trim();
      if (url) {
        const section = folders[0];
        feeds.push({
          url,
          ...(label ? { title: label } : {}),
          ...(section ? { section } : {}),
        });
      }
      if (!tag.trimEnd().endsWith('/')) {
        const isFolder = !url && label !== '';
        open.push(isFolder);
        if (isFolder) folders.push(label);
      }
      at = end - 1;
    }
    at = text.indexOf('<', at + 1);
  }
  return { ok: true, feeds };
}

/** A feed and its section name, for {@link buildOpml}. */
export interface OpmlEntry {
  readonly url: string;
  readonly title: string;
  /** The feed's website, written as `htmlUrl`. */
  readonly site_url?: string;
  readonly section?: string;
}

/** An OPML 2.0 document with the entries grouped under their sections. */
export function buildOpml(
  title: string,
  entries: readonly OpmlEntry[],
  sections: readonly string[],
): string {
  const outline = (e: OpmlEntry, indent: string): string =>
    `${indent}<outline type="rss" text="${escapeXml(e.title)}" title="${escapeXml(e.title)}" xmlUrl="${escapeXml(e.url)}"${e.site_url ? ` htmlUrl="${escapeXml(e.site_url)}"` : ''}/>`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${escapeXml(title)}</title></head>`,
    '  <body>',
    ...entries.filter((e) => !e.section).map((e) => outline(e, '    ')),
  ];
  for (const name of sections) {
    const inside = entries.filter((e) => e.section === name);
    if (!inside.length) continue;
    lines.push(`    <outline text="${escapeXml(name)}">`);
    lines.push(...inside.map((e) => outline(e, '      ')));
    lines.push('    </outline>');
  }
  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}
