import type { Check } from "../context.js";
import { loadPage } from "../pages.js";
import type { Issue } from "../types.js";

export const nojs: Check = async (ctx) => {
  const issues: Issue[] = [];
  await Promise.all(
    ctx.pages.map(async (p) => {
      const page = await loadPage(ctx, p.url);
      const info = page.info;
      if (!info) return;
      const url = p.url;
      const add = (id: string, level: Issue["level"], message: string, detail?: unknown): void => {
        issues.push({ check: "nojs", id, level, url, message, detail });
      };
      const counts = { words: info.words, links: info.links };

      if (!info.title) add("nojs-no-title", "error", "No <title> in the raw HTML.", counts);
      if (info.h1Count === 0) add("nojs-no-h1", "error", "No <h1> in the raw HTML.", counts);

      const emptyRoot = info.spaRoots.find((r) => r.empty);
      const emptySpa = info.words < 50 && emptyRoot !== undefined;
      if (emptySpa) {
        add(
          "nojs-empty-spa",
          "error",
          `Raw HTML has only ${info.words} words and an empty #${emptyRoot.id}, crawlers without JavaScript see a blank page.`,
          { ...counts, root: emptyRoot.id },
        );
      }
      if (!info.description) add("nojs-no-description", "warn", "No meta description in the raw HTML.");
      if (info.links < 3) {
        add("nojs-few-links", "warn", `Only ${info.links} internal link(s) in the raw HTML.`, counts);
      }
      if (!emptySpa && info.mainWords < 150) {
        add("nojs-thin-content", "warn", `Main text has ${info.mainWords} words in the raw HTML, under 150.`, {
          mainWords: info.mainWords,
        });
      }
      const xrobots = page.headers["x-robots-tag"] ?? "";
      if (info.noindexMeta || /\b(noindex|none)\b/i.test(xrobots)) {
        add(
          "nojs-noindex",
          p.inSitemap ? "warn" : "info",
          p.inSitemap ? "Page is noindex." : "Page is noindex and not in the sitemap.",
          { source: info.noindexMeta ? "meta" : "x-robots-tag" },
        );
      }
    }),
  );
  return issues;
};
