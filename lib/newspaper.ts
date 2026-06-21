import sections from "@/data/newspaper.json";
import type { Section } from "./types";

/** The frozen front page — extracted from the original static snapshot. */
export const EDITION = {
  title: "The Hacker Times",
  tagline: "“All the News That’s Fit to Upvote”",
  volume: "Vol. I · No. 1",
  strapline: "Hacker News Front Page",
  price: "Price: One Upvote",
  date: "Friday, June 19, 2026",
  place: "San Francisco · The Cloud",
  edition: "Top 20 Stories",
  footer:
    "THE HACKER TIMES — auto-generated from the Hacker News API · Friday, June 19, 2026 · News 13 · Opinion 33 · Show HN 3 · Hiring 1 · 37/20 illustrated",
  enginenote:
    "Layout: CSS Grid Level 3 “grid-lanes” masonry where supported (Safari/iOS), with multicolumn fallback elsewhere.",
} as const;

export const getSections = (): Section[] => sections as Section[];

/** Public-path helper: snapshot stored asset paths as "img/01.png". */
export const asset = (src: string | null): string | undefined =>
  src ? `/${src.replace(/^\/+/, "")}` : undefined;
