/** A scraped feed item before it's persisted. @public */
export interface ScrapedItem {
  url: string;
  title: string;
  source: string;
  image: string;
  favicon: string;
  summary: string;
  published_at: string;
}
