import type { Fetcher } from "./fetch.js";
import type { Options } from "./types.js";

/** One page in the audited set, with its raw (no JS) HTML already fetched. */
export interface Page {
  url: string;
  /** True when the URL came from a sitemap (false for the start URL only). */
  inSitemap: boolean;
}

/** Everything a check needs. Checks fetch through `fetcher` so every URL is requested once. */
export interface Context {
  options: Options;
  fetcher: Fetcher;
  origin: string;
  pages: Page[];
  /** Sitemap URLs found (robots.txt Sitemap lines or /sitemap.xml), in discovery order. */
  sitemaps: string[];
  /** All URLs listed in the sitemaps, before sampling. */
  sitemapUrls: string[];
  /** hreflang alternates declared in sitemaps: page url -> [{lang, href}]. */
  sitemapAlternates: Map<string, { lang: string; href: string }[]>;
  /** robots.txt body, empty string when missing. */
  robotsTxt: string;
}

/** Every check module exports one function with this shape. */
export type Check = (ctx: Context) => Promise<import("./types.js").Issue[]>;
