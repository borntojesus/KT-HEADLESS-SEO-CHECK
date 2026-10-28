export type Level = "error" | "warn" | "info";

export type CheckName = "redirects" | "canonical" | "hreflang" | "sitemap" | "nojs" | "robots";

export const CHECKS: readonly CheckName[] = [
  "redirects",
  "canonical",
  "hreflang",
  "sitemap",
  "nojs",
  "robots",
];

export interface Issue {
  check: CheckName;
  id: string;
  level: Level;
  url: string;
  message: string;
  detail?: unknown;
}

export interface Options {
  startUrl: string;
  maxPages: number;
  concurrency: number;
  timeout: number;
  userAgent: string;
  only: CheckName[];
  redirectsFile?: string;
}

export interface PageSummary {
  url: string;
  status: number;
  finalUrl: string;
  words: number;
  links: number;
}

export interface Report {
  version: string;
  startUrl: string;
  pages: PageSummary[];
  issues: Issue[];
  summary: { errors: number; warnings: number; info: number };
}
