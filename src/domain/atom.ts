/**
 * @packageDocumentation
 *
 * Atom (RFC 4287) documents for `/feed.xml`: a list of stories written out so
 * any feed reader can follow a person's saves, a section or their edition.
 */

/** One entry of a feed. */
export interface AtomEntry {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updated: string;
  readonly summary?: string | undefined;
  readonly source?: string | undefined;
  /** The story's full text, when it was kept. */
  readonly content?: string | undefined;
  /** Labels on the entry (a saved story's tags). */
  readonly categories?: readonly string[] | undefined;
}

/** A whole feed. */
export interface AtomFeed {
  readonly id: string;
  readonly title: string;
  readonly self: string;
  readonly site: string;
  readonly updated: string;
  readonly entries: readonly AtomEntry[];
}

/** Text made safe inside XML. */
export function escapeXml(text: string): string {
  return (
    text
      // Characters XML 1.0 cannot carry at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

/** One entry as XML. */
function entryXml(entry: AtomEntry): string {
  return [
    '  <entry>',
    `    <id>${escapeXml(entry.id)}</id>`,
    `    <title>${escapeXml(entry.title)}</title>`,
    `    <link rel="alternate" href="${escapeXml(entry.url)}"/>`,
    `    <updated>${escapeXml(entry.updated)}</updated>`,
    ...(entry.source
      ? [`    <author><name>${escapeXml(entry.source)}</name></author>`]
      : []),
    ...(entry.categories ?? []).map(
      (term) => `    <category term="${escapeXml(term)}"/>`,
    ),
    ...(entry.summary
      ? [`    <summary>${escapeXml(entry.summary)}</summary>`]
      : []),
    ...(entry.content
      ? [`    <content type="text">${escapeXml(entry.content)}</content>`]
      : []),
    '  </entry>',
  ].join('\n');
}

/** The feed as an Atom document. */
export function atomXml(feed: AtomFeed): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(feed.id)}</id>`,
    `  <title>${escapeXml(feed.title)}</title>`,
    `  <link rel="self" href="${escapeXml(feed.self)}"/>`,
    `  <link rel="alternate" href="${escapeXml(feed.site)}"/>`,
    `  <updated>${escapeXml(feed.updated)}</updated>`,
    ...feed.entries.map(entryXml),
    '</feed>',
    '',
  ].join('\n');
}
