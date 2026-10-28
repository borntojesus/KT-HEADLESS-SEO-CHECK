import type { Check } from "../context.js";
import { loadPage, readSitemap } from "../pages.js";
import type { Issue } from "../types.js";
import { normUrl, sameUrl } from "../url.js";
import { isRedirect } from "../fetch.js";

const MAX_URLS = 50_000;
const MAX_BYTES = 50 * 1024 * 1024;
const LASTMOD = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

function validLastmod(v: string): boolean {
  if (!LASTMOD.test(v) || Number.isNaN(Date.parse(v))) return false;
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return day.getUTCFullYear() === y && day.getUTCMonth() === (m ?? 1) - 1 && day.getUTCDate() === d;
}

export const sitemap: Check = async (ctx) => {
  const issues: Issue[] = [];
  const add = (id: string, level: Issue["level"], url: string, message: string, detail?: unknown): void => {
    issues.push({ check: "sitemap", id, level, url, message, detail });
  };

  const files = await Promise.all(ctx.sitemaps.map((u) => readSitemap(ctx.fetcher, u)));
  const usable = files.filter((f) => f.kind === "urlset" || f.kind === "index");
  const declared = /^\s*sitemap\s*:/im.test(ctx.robotsTxt);

  for (const f of files) {
    if (f.kind === "missing") {
      add("sitemap-missing", "error", f.url, `Sitemap not found (${f.status === 0 ? "request failed" : "HTTP " + f.status}).`, {
        status: f.status,
      });
    } else if (f.kind === "invalid") {
      add("sitemap-not-xml", "error", f.url, "Sitemap is not valid sitemap XML.");
    }
  }

  let total = 0;
  for (const f of usable) {
    total += f.entries.length;
    if (f.entries.length > MAX_URLS) {
      add("sitemap-too-many-urls", "warn", f.url, `Sitemap lists ${f.entries.length} URLs, the limit is ${MAX_URLS} per file.`, {
        count: f.entries.length,
      });
    }
    if (f.bytes > MAX_BYTES) {
      add("sitemap-too-large", "warn", f.url, `Sitemap is ${f.bytes} bytes, the limit is 50 MB uncompressed per file.`, {
        bytes: f.bytes,
      });
    }
    const bad = f.entries.filter((e) => e.lastmod !== undefined && !validLastmod(e.lastmod));
    if (bad.length > 0) {
      add("sitemap-bad-lastmod", "warn", f.url, `${bad.length} URL(s) have an invalid lastmod, use W3C date format such as 2026-01-31.`, {
        examples: bad.slice(0, 5).map((e) => ({ loc: e.loc, lastmod: e.lastmod })),
      });
    }
    if (!declared && ctx.sitemaps[0] !== undefined && sameUrl(f.url, ctx.sitemaps[0])) {
      add("sitemap-not-in-robots", "warn", f.url, "Sitemap is not listed in robots.txt with a Sitemap line.");
    }
  }

  const sitemapPages = ctx.pages.filter((p) => p.inSitemap);
  await Promise.all(
    sitemapPages.map(async (p) => {
      const res = await ctx.fetcher.fetchOnce(p.url);
      if (isRedirect(res.status)) {
        add("sitemap-url-redirect", "error", p.url, `URL in sitemap redirects (HTTP ${res.status}), list the final URL instead.`, {
          status: res.status,
          location: res.location,
        });
        return;
      }
      if (res.status !== 200) {
        add("sitemap-url-status", "error", p.url, `URL in sitemap returns ${res.status === 0 ? "no response" : "HTTP " + res.status}.`, {
          status: res.status,
          error: res.error,
        });
        return;
      }
      const page = await loadPage(ctx, p.url);
      const xrobots = res.headers["x-robots-tag"] ?? "";
      if (page.info?.noindexMeta || /\b(noindex|none)\b/i.test(xrobots)) {
        add("sitemap-url-noindex", "error", p.url, "URL in sitemap is marked noindex.");
      }
      const canonical = page.info?.canonical;
      if (canonical && normUrl(canonical) !== normUrl(p.url)) {
        add("sitemap-url-canonical", "error", p.url, "URL in sitemap has a canonical pointing to another URL.", { canonical });
      }
    }),
  );

  if (usable.length > 0) {
    add(
      "sitemap-summary",
      "info",
      usable[0]?.url ?? ctx.origin,
      `${total} URLs in ${usable.length} sitemap file(s), ${sitemapPages.length} sampled.`,
      { files: usable.length, urls: total, sampled: sitemapPages.length },
    );
  }
  return issues;
};
