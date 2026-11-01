import { countOf } from '@/lib/intl';
/**
 * @packageDocumentation
 *
 * Wording for what a feed says about itself: a readable label for any header
 * element a feed declares, how often it says it changes, and its format.
 */

/** Labels for the elements whose names do not read well when split. */
const LABELS: Readonly<Record<string, string>> = {
  ttl: 'Time to live (minutes)',
  managingEditor: 'Managing editor',
  webMaster: 'Webmaster',
  pubDate: 'Published',
  lastBuildDate: 'Last built',
  skipHours: 'Skipped hours',
  skipDays: 'Skipped days',
  textInput: 'Text input',
  url: 'Address',
  uri: 'Address',
  id: 'Identifier',
  subtitle: 'Subtitle',
  rights: 'Rights',
};

/** Spell out the namespace prefixes feeds use most. */
const PREFIXES: Readonly<Record<string, string>> = {
  sy: 'Syndication',
  dc: 'Dublin Core',
  atom: 'Atom',
  itunes: 'iTunes',
  media: 'Media',
  content: 'Content',
  podcast: 'Podcast',
  googleplay: 'Google Play',
};

/** `updatePeriod` → `Update period`, `last-modified` → `Last modified`. */
function words(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A readable label for a header element name, prefix included:
 * `lastBuildDate` → `Last built`, `sy:updatePeriod` → `Update period
 * (Syndication)`, `foo:barBaz` → `Bar baz (foo)`.
 */
export function elementLabel(name: string): string {
  const colon = name.indexOf(':');
  const local = colon >= 0 ? name.slice(colon + 1) : name;
  const prefix = colon >= 0 ? name.slice(0, colon) : '';
  const label = LABELS[local] ?? words(local);
  return prefix ? `${label} (${PREFIXES[prefix] ?? prefix})` : label;
}

/** How often a feed says it changes: `every 30 minutes`, `hourly`, `every 2 days`. */
export function updateFrequency(minutes: number): string {
  if (minutes === 60) return 'hourly';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'weekly';
  if (minutes % 1440 === 0) return `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `every ${minutes / 60} hours`;
  return `every ${countOf(minutes, 'minute')}`;
}

/** The name of a feed format as people know it. */
export function formatName(format: string): string {
  return format === 'rss'
    ? 'RSS'
    : format === 'atom'
      ? 'Atom'
      : format === 'rdf'
        ? 'RSS 1.0 (RDF)'
        : format;
}

/** An element of a feed's header, as {@link headerFacts} reads it. */
interface Element {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly Element[];
}

/** One readable fact a feed declares about itself. */
export interface HeaderFact {
  readonly label: string;
  readonly value: string;
}

/** The text of a child element by local name, or blank. */
function child(e: Element, name: string): string {
  return (
    e.children.find((c) => c.name.replace(/^.*:/, '') === name)?.text ?? ''
  );
}

/**
 * How one element reads in a sentence: its text, else its children's texts
 * (an Atom `<author>` reads as its name, email and address), else its
 * attributes (an RSS `<cloud>` or an Atom `<category term>`).
 */
function phrase(e: Element): string {
  if (e.text && !Object.keys(e.attributes).length) return e.text;
  const parts = [
    e.text,
    ...e.children.map((c) => phrase(c)).filter(Boolean),
    ...Object.entries(e.attributes)
      .filter(([k]) => !k.startsWith('xmlns'))
      .map(([k, v]) => `${k} ${v}`),
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Elements the summary already shows on its own, and the items themselves. */
const SHOWN = new Set([
  'title',
  'link',
  'description',
  'subtitle',
  'language',
  'image',
  'icon',
  'logo',
  'item',
  'entry',
  'items',
]);

/**
 * Every element a feed declares, as readable facts in the order the feed gives
 * them, repeated elements (categories, authors, skipped hours) joined into one
 * line. Only the few the summary shows on its own are left out.
 */
export function headerFacts(elements: readonly Element[]): HeaderFact[] {
  const facts = new Map<string, string[]>();
  for (const e of elements) {
    const local = e.name.replace(/^.*:/, '');
    if (SHOWN.has(local) && !e.name.includes(':')) continue;
    const value = phrase(e);
    if (!value) continue;
    const label = elementLabel(e.name);
    facts.set(label, [...(facts.get(label) ?? []), value]);
  }
  return [...facts].map(([label, values]) => ({
    label,
    value: values.join(', '),
  }));
}

/** The feed's own image block (RSS `<image>`, Atom `<logo>` or `<icon>`), if any. */
export function headerImage(
  elements: readonly Element[],
): { url: string; title: string; link: string } | undefined {
  const image = elements.find((e) => e.name === 'image');
  if (image && child(image, 'url')) {
    return {
      url: child(image, 'url'),
      title: child(image, 'title'),
      link: child(image, 'link'),
    };
  }
  const logo = elements.find((e) => e.name === 'logo' || e.name === 'icon');
  return logo?.text ? { url: logo.text, title: '', link: '' } : undefined;
}
