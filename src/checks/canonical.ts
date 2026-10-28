import { parse } from "node-html-parser";
import type { Check, Context } from "../context.js";
import { bodyText } from "../fetch.js";
import type { Issue } from "../types.js";
import { isAbsoluteHttp, resolveUrl, sameUrl } from "../url.js";

function issue(id: string, level: Issue["level"], url: string, message: string, detail?: unknown): Issue {
  return { check: "canonical", id, level, url, message, detail };
}

/** Parse a Link header into entries with the target and its parameters. */
export function parseLinkHeader(header: string | undefined): { href: string; params: Record<string, string> }[] {
  if (!header) return [];
  const out: { href: string; params: Record<string, string> }[] = [];
  const re = /<([^>]*)>((?:\s*;\s*[^;,<]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    const params: Record<string, string> = {};
    for (const part of (m[2] ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
    }
    out.push({ href: (m[1] ?? "").trim(), params });
  }
  return out;
}

export function isNoindex(headers: Record<string, string>, root: ReturnType<typeof parse> | null): boolean {
  if (/noindex|none/i.test(headers["x-robots-tag"] ?? "")) return true;
  if (!root) return false;
  return root.querySelectorAll("meta").some((m) => {
    const name = (m.getAttribute("name") ?? "").toLowerCase();
    return (name === "robots" || name === "googlebot") && /noindex|none/i.test(m.getAttribute("content") ?? "");
  });
}

export const canonical: Check = async (ctx: Context) => {
  const out: Issue[] = [];
  await Promise.all(
    ctx.pages.map(async (page) => {
      const chain = await ctx.fetcher.chain(page.url);
      const res = chain.final;
      if (chain.status !== 200 || chain.error) return;
      if (!/html/i.test(res.headers["content-type"] ?? "html")) return;
      const root = parse(bodyText(res));
      const pageUrl = chain.finalUrl;

      const raw: { value: string; source: "html" | "header" }[] = [];
      for (const l of root.querySelectorAll("link")) {
        if ((l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
          raw.push({ value: (l.getAttribute("href") ?? "").trim(), source: "html" });
        }
      }
      for (const l of parseLinkHeader(res.headers["link"])) {
        if ((l.params["rel"] ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
          raw.push({ value: l.href, source: "header" });
        }
      }

      if (raw.length === 0) {
        out.push(issue("canonical-missing", "warn", page.url, "No canonical link in the HTML or the Link header"));
        return;
      }

      const resolved = raw.map((r) => ({ ...r, abs: resolveUrl(r.value, pageUrl) }));
      const distinct = new Set(resolved.map((r) => r.abs ?? r.value));
      const htmlCount = raw.filter((r) => r.source === "html").length;
      if (htmlCount > 1 || distinct.size > 1) {
        out.push(
          issue(
            "canonical-multiple",
            "error",
            page.url,
            `${raw.length} canonical declarations${distinct.size > 1 ? " that disagree" : ""}`,
            { canonicals: raw },
          ),
        );
      }

      const first = resolved[0]!;
      if (!first.value || !first.abs) {
        out.push(issue("canonical-invalid", "error", page.url, `Canonical is not a usable URL: "${first.value}"`));
        return;
      }
      if (!isAbsoluteHttp(first.value)) {
        out.push(
          issue("canonical-relative", "warn", page.url, `Canonical is a relative URL (${first.value}), use an absolute one`, {
            resolved: first.abs,
          }),
        );
      }

      if (isNoindex(res.headers, root)) {
        out.push(issue("canonical-noindex", "error", page.url, "Page has a canonical but is also noindex"));
      }

      const ogUrl = root.querySelector('meta[property="og:url"]')?.getAttribute("content")?.trim();
      if (ogUrl) {
        const og = resolveUrl(ogUrl, pageUrl);
        if (og && !sameUrl(og, first.abs)) {
          out.push(
            issue("canonical-og-mismatch", "warn", page.url, `og:url (${og}) differs from the canonical (${first.abs})`, {
              ogUrl: og,
              canonical: first.abs,
            }),
          );
        }
      }

      if (sameUrl(first.abs, pageUrl) || sameUrl(first.abs, page.url)) return;

      const target = await ctx.fetcher.fetchOnce(first.abs);
      if (target.error || target.status !== 200) {
        out.push(
          issue(
            "canonical-target-status",
            "error",
            page.url,
            target.error
              ? `Canonical target ${first.abs} cannot be fetched: ${target.error}`
              : `Canonical target ${first.abs} answers ${target.status}${target.location ? ` and redirects to ${target.location}` : ""}, expected 200`,
            { canonical: first.abs, status: target.status, location: target.location },
          ),
        );
        return;
      }
      const targetRoot = /html/i.test(target.headers["content-type"] ?? "html") ? parse(bodyText(target)) : null;
      if (isNoindex(target.headers, targetRoot)) {
        out.push(
          issue("canonical-target-noindex", "error", page.url, `Canonical target ${first.abs} is noindex`, {
            canonical: first.abs,
          }),
        );
        return;
      }
      out.push(
        issue("canonical-other", "info", page.url, `Canonical points to another URL (${first.abs}), which is fine when intended`, {
          canonical: first.abs,
        }),
      );
    }),
  );
  return out;
};
