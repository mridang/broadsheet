/**
 * @packageDocumentation
 *
 * OPML on the wire: the subscription list a person exports from, or imports
 * into, a feed reader. Parsing is a small tolerant scan of `<outline>` tags
 * (Workers have no DOM); a document that declares entities is refused.
 */

/** Media type of an OPML document. */
export const OPML_TYPE = 'text/x-opml';

/** Deepest folder nesting kept when reading OPML; deeper feeds sit at this level. */
export const MAX_OPML_DEPTH = 8;

/** A feed found in an OPML document, with the folders it sat under. */
export interface OpmlFeed {
  readonly url: string;
  readonly title?: string;
  /** The feed's website, from `htmlUrl`. */
  readonly site_url?: string;
  /** The folders from the outermost in, empty for none. */
  readonly sections?: readonly string[];
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function unescapeXml(text: string): string {
  return text.replaceAll(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10_FF_FF
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
      return end === -1 ? -1 : end + close.length;
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
        const site = attrs.get('htmlurl')?.trim();
        feeds.push({
          url,
          ...(label ? { title: label } : {}),
          ...(site ? { site_url: site } : {}),
          ...(folders.length > 0
            ? { sections: folders.slice(0, MAX_OPML_DEPTH) }
            : {}),
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

/** A feed to write, filed under the section with id `section_id` if any. */
export interface OpmlEntry {
  readonly url: string;
  readonly title: string;
  /** The feed's website, written as `htmlUrl`. */
  readonly site_url?: string;
  readonly section_id?: number | null;
}

/** A section to write as a folder; a null parent is top level. */
export interface OpmlSection {
  readonly id: number;
  readonly name: string;
  readonly parent_id: number | null;
}

/**
 * An OPML 2.0 document: feeds with no section first, then each section as a
 * folder holding its feeds and its sub-sections. Empty sections are left out.
 */
export function buildOpml(
  title: string,
  entries: readonly OpmlEntry[],
  sections: readonly OpmlSection[],
  now: Date = new Date(),
): string {
  const outline = (e: OpmlEntry, indent: string): string =>
    `${indent}<outline type="rss" version="RSS" text="${escapeXml(e.title)}" title="${escapeXml(e.title)}" xmlUrl="${escapeXml(e.url)}"${e.site_url ? ` htmlUrl="${escapeXml(e.site_url)}"` : ''}/>`;
  const known = new Set(sections.map((s) => s.id));
  const inside = (id: number | null): OpmlEntry[] =>
    entries.filter((e) =>
      id === null
        ? e.section_id == null || !known.has(e.section_id)
        : e.section_id === id,
    );
  const folder = (
    section: OpmlSection,
    depth: number,
    seen: Set<number>,
  ): string[] => {
    if (seen.has(section.id)) return [];
    const path = new Set(seen).add(section.id);
    const indent = '  '.repeat(depth);
    const body = [
      ...inside(section.id).map((e) => outline(e, `${indent}  `)),
      ...sections
        .filter((s) => s.parent_id === section.id)
        .flatMap((s) => folder(s, depth + 1, path)),
    ];
    return body.length > 0
      ? [
          `${indent}<outline text="${escapeXml(section.name)}" title="${escapeXml(section.name)}">`,
          ...body,
          `${indent}</outline>`,
        ]
      : [];
  };
  const stamp = now.toUTCString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${escapeXml(title)}</title><dateCreated>${stamp}</dateCreated><dateModified>${stamp}</dateModified></head>`,
    '  <body>',
    ...inside(null).map((e) => outline(e, ' '.repeat(4))),
    ...sections
      .filter((s) => s.parent_id === null || !known.has(s.parent_id))
      .flatMap((s) => folder(s, 2, new Set())),
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
