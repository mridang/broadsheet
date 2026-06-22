/**
 * @packageDocumentation
 *
 * The generative layout engine. A story's tier emerges from its position
 * in its section's own weight order (recency + image + length), the tier
 * fixes the lane span and excerpt budget, and the excerpt is copyfit to
 * that budget. Different content ⇒ a different page, with no code change.
 */
import type { Article } from '../db';

export type Tier = 'lead' | 'feature' | 'standard' | 'brief';

/** tier -> [lane span, excerpt char budget]. */
export const TIER: Record<Tier, readonly [number, number]> = {
  lead: [3, 620],
  feature: [2, 340],
  standard: [1, 190],
  brief: [1, 0],
};

/** Tiers emerge from the feed's own set (articles arrive newest-first). */
export function assignTiers(arts: Article[]): Tier[] {
  const n = arts.length;
  return arts.map((a, i) => {
    const hasImg = !!a.image;
    const len = (a.summary ?? '').length;
    if (i === 0 && n >= 5) return 'lead';
    if (i <= Math.max(1, Math.floor(n / 6)) && hasImg && len > 200)
      return 'feature';
    if ((!len || len < 120) && i >= n * 0.5) return 'brief';
    return 'standard';
  });
}

/** Copyfit: trim to the budget at a word boundary, then append an ellipsis. */
export function excerpt(s: string | null, n: number): string {
  const t = (s ?? '').trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

export function ago(iso: string | null): string {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (isNaN(h)) return '';
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
