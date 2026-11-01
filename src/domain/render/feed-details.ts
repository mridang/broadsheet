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
  return `every ${minutes} minute${minutes === 1 ? '' : 's'}`;
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
