import { Fetcher } from "./fetch.js";
import { buildContext, pageSummaries } from "./pages.js";
import { canonical } from "./checks/canonical.js";
import { hreflang } from "./checks/hreflang.js";
import { nojs } from "./checks/nojs.js";
import { redirects } from "./checks/redirects.js";
import { robots } from "./checks/robots.js";
import { sitemap } from "./checks/sitemap.js";
import type { Check } from "./context.js";
import { sortIssues, summarize } from "./report.js";
import { CHECKS } from "./types.js";
import type { CheckName, Options, Report } from "./types.js";
import { DEFAULT_USER_AGENT, VERSION } from "./version.js";

const RUNNERS: Record<CheckName, Check> = { redirects, canonical, hreflang, sitemap, nojs, robots };

/** Fill in defaults for everything except the start URL. */
export function resolveOptions(input: Partial<Options> & { startUrl: string }): Options {
  return {
    startUrl: input.startUrl,
    maxPages: input.maxPages ?? 25,
    concurrency: input.concurrency ?? 4,
    timeout: input.timeout ?? 15000,
    userAgent: input.userAgent ?? DEFAULT_USER_AGENT,
    only: input.only ?? [],
    redirectsFile: input.redirectsFile,
  };
}

/** Run the audit: fetch the page set, run the selected checks, return a sorted report. */
export async function audit(input: Partial<Options> & { startUrl: string }): Promise<Report> {
  const options = resolveOptions(input);
  const fetcher = new Fetcher({
    timeout: options.timeout,
    userAgent: options.userAgent,
    concurrency: options.concurrency,
  });
  const ctx = await buildContext(options, fetcher);
  const selected = options.only.length > 0 ? CHECKS.filter((c) => options.only.includes(c)) : CHECKS;
  const results = await Promise.all(selected.map((name) => RUNNERS[name](ctx)));
  const issues = sortIssues(results.flat());
  const pages = await pageSummaries(ctx);
  return { version: VERSION, startUrl: options.startUrl, pages, issues, summary: summarize(issues) };
}

export { CHECKS, VERSION, DEFAULT_USER_AGENT };
export { formatHuman, formatJson } from "./report.js";
export type { CheckName, Issue, Level, Options, PageSummary, Report } from "./types.js";
