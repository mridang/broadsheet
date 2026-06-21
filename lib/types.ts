export type Tier = "lead" | "feature" | "standard";
export type BadgeKind = "op" | "show" | "hire";
export type SectionKind = "news" | "opinion" | "show" | "hiring";

export interface Badge {
  kind: BadgeKind;
  label: string;
}

export interface StoryImage {
  src: string;
  side: "l" | "r";
}

export interface Story {
  num: string;
  href: string;
  sectionClass: string;
  tier: Tier;
  /** Lane span: 1–4, or "all" for full-width bands. */
  span: number | "all";
  noimg: boolean;
  favicon: string | null;
  publisher: string;
  badge: Badge | null;
  score: string;
  headline: string;
  byline: string | null;
  image: StoryImage | null;
  excerpt: string;
}

export interface BriefItem {
  href: string;
  title: string;
  scoreLabel: string;
}

export interface Job {
  href: string;
  title: string;
  meta: string;
}

interface SectionBase {
  title: string;
  desc: string;
  count: string;
}

export interface StorySection extends SectionBase {
  kind: "news" | "opinion" | "show";
  stories: Story[];
  brief: BriefItem[] | null;
}

export interface HiringSection extends SectionBase {
  kind: "hiring";
  jobs: Job[];
}

export type Section = StorySection | HiringSection;
