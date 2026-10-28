import { parse } from "node-html-parser";
import type { Check, Context } from "../context.js";
import { bodyText } from "../fetch.js";
import type { Issue } from "../types.js";
import { resolveUrl, sameUrl } from "../url.js";
import { parseLinkHeader } from "./canonical.js";

function issue(id: string, level: Issue["level"], url: string, message: string, detail?: unknown): Issue {
  return { check: "hreflang", id, level, url, message, detail };
}

type Alt = { lang: string; href: string };

/** x-default, or language (2 or 3 letters) with optional script (4 letters) and optional region (2 letters or 3 digits). */
export function validHreflang(code: string): boolean {
  if (code.toLowerCase() === "x-default") return true;
  return /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?$/.test(code);
}

function dedupe(list: Alt[]): Alt[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = `${a.lang.toLowerCase()}|${a.href}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface PageInfo {
  status: number;
  alts: Alt[];
  canonical?: string;
}

async function readPage(ctx: Context, url: string): Promise<PageInfo> {
  const res = await ctx.fetcher.fetchOnce(url);
  const alts: Alt[] = [];
  let canonical: string | undefined;
  if (res.status === 200 && /html/i.test(res.headers["content-type"] ?? "html")) {
    const root = parse(bodyText(res));
    for (const l of root.querySelectorAll("link")) {
      const rel = (l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
      const href = l.getAttribute("href");
      if (!href) continue;
      if (rel.includes("alternate") && l.getAttribute("hreflang")) {
        alts.push({ lang: l.getAttribute("hreflang")!.trim(), href: resolveUrl(href, url) ?? href });
      } else if (rel.includes("canonical") && !canonical) {
        canonical = resolveUrl(href, url) ?? undefined;
      }
    }
  }
  if (res.status === 200) {
    for (const l of parseLinkHeader(res.headers["link"])) {
      const rel = (l.params["rel"] ?? "").toLowerCase().split(/\s+/);
      if (rel.includes("alternate") && l.params["hreflang"]) {
        alts.push({ lang: l.params["hreflang"], href: resolveUrl(l.href, url) ?? l.href });
      } else if (rel.includes("canonical") && !canonical) {
        canonical = resolveUrl(l.href, url) ?? undefined;
      }
    }
  }
  for (const a of ctx.sitemapAlternates.get(url) ?? []) {
    alts.push({ lang: a.lang, href: resolveUrl(a.href, url) ?? a.href });
  }
  return { status: res.status, alts: dedupe(alts), canonical };
}

export const hreflang: Check = async (ctx: Context) => {
  const out: Issue[] = [];
  await Promise.all(
    ctx.pages.map(async (page) => {
      const info = await readPage(ctx, page.url);
      if (info.alts.length === 0) return;

      for (const a of info.alts) {
        if (!validHreflang(a.lang)) {
          out.push(
            issue("hreflang-invalid-code", "error", page.url, `Invalid hreflang value "${a.lang}", use a language or language-region code like en or en-GB`, {
              lang: a.lang,
              href: a.href,
            }),
          );
        }
      }

      if (!info.alts.some((a) => sameUrl(a.href, page.url))) {
        out.push(issue("hreflang-no-self", "error", page.url, "The page does not list itself in its hreflang set"));
      }
      if (!info.alts.some((a) => a.lang.toLowerCase() === "x-default")) {
        out.push(issue("hreflang-no-x-default", "warn", page.url, "No x-default alternate"));
      }

      const targets = [...new Set(info.alts.filter((a) => !sameUrl(a.href, page.url)).map((a) => a.href))];
      await Promise.all(
        targets.map(async (href) => {
          const langs = info.alts.filter((a) => a.href === href).map((a) => a.lang);
          const alt = await readPage(ctx, href);
          if (alt.status !== 200) {
            out.push(
              issue("hreflang-alternate-status", "error", page.url, `Alternate ${href} (${langs.join(", ")}) answers ${alt.status || "no response"}, expected 200`, {
                href,
                status: alt.status,
              }),
            );
            return;
          }
          if (!alt.alts.some((a) => sameUrl(a.href, page.url))) {
            out.push(
              issue("hreflang-missing-return", "error", page.url, `Alternate ${href} does not link back to this page`, {
                href,
                lang: langs,
              }),
            );
          }
          if (alt.canonical && !sameUrl(alt.canonical, href)) {
            out.push(
              issue("hreflang-alternate-not-canonical", "warn", page.url, `Alternate ${href} has a different canonical (${alt.canonical})`, {
                href,
                canonical: alt.canonical,
              }),
            );
          }
        }),
      );
    }),
  );
  return out;
};
