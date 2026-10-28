import { readFile } from "node:fs/promises";
import type { Check, Context } from "../context.js";
import { MAX_HOPS, isRedirect, type Chain } from "../fetch.js";
import type { Issue } from "../types.js";
import { normUrl, resolveUrl } from "../url.js";

function issue(id: string, level: Issue["level"], url: string, message: string, detail?: unknown): Issue {
  return { check: "redirects", id, level, url, message, detail };
}

function chainDetail(chain: Chain) {
  return chain.hops.map((h) => ({ url: h.url, status: h.status, location: h.location }));
}

/** Does this hop only change scheme, trailing slash or host? Those should be permanent. */
function isCanonicalizingHop(from: string, to: string): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    if (a.host !== b.host) return true;
    if (a.protocol !== b.protocol) return true;
    const strip = (p: string) => p.replace(/\/+$/, "");
    return strip(a.pathname) === strip(b.pathname) && a.search === b.search;
  } catch {
    return false;
  }
}

export const redirects: Check = async (ctx: Context) => {
  const out: Issue[] = [];
  await Promise.all(
    ctx.pages.map(async (page) => {
      const chain = await ctx.fetcher.chain(page.url);
      const hops = chain.hops;
      const redirectHops = hops.filter((h) => isRedirect(h.status) && h.location);

      if (chain.error) {
        out.push(
          issue("redirect-fetch-failed", "error", page.url, `Request failed: ${chain.error}`, {
            hops: chainDetail(chain),
          }),
        );
        return;
      }
      if (chain.loop) {
        out.push(issue("redirect-loop", "error", page.url, "Redirect loop", { hops: chainDetail(chain) }));
        return;
      }
      if (chain.tooLong) {
        out.push(
          issue("redirect-too-long", "error", page.url, `Redirect chain is longer than ${MAX_HOPS} hops`, {
            hops: chainDetail(chain),
          }),
        );
        return;
      }
      if (chain.status !== 200) {
        out.push(
          issue("redirect-final-status", "error", page.url, `Final status is ${chain.status}, expected 200`, {
            finalUrl: chain.finalUrl,
            status: chain.status,
            hops: chainDetail(chain),
          }),
        );
      }
      if (redirectHops.length > 1) {
        out.push(
          issue(
            "redirect-multiple-hops",
            "warn",
            page.url,
            `${redirectHops.length} redirects before the final page, one is enough`,
            { hops: chainDetail(chain) },
          ),
        );
      }
      for (const h of redirectHops) {
        if ((h.status === 302 || h.status === 307) && h.location && isCanonicalizingHop(h.url, h.location)) {
          out.push(
            issue(
              "redirect-temporary",
              "warn",
              page.url,
              `${h.status} used from ${h.url} to ${h.location}, a 301 or 308 is expected here`,
              { from: h.url, to: h.location, status: h.status },
            ),
          );
        }
      }
      for (let i = 1; i < hops.length; i++) {
        const prev = hops[i - 1]!;
        const cur = hops[i]!;
        if (prev.url.startsWith("https:") && cur.url.startsWith("http:")) {
          out.push(
            issue("redirect-mixed-http", "warn", page.url, `Redirect from https to http at ${cur.url}`, {
              from: prev.url,
              to: cur.url,
            }),
          );
        }
      }
    }),
  );
  if (ctx.options.redirectsFile) {
    try {
      const text = await readFile(ctx.options.redirectsFile, "utf8");
      out.push(...(await checkRedirectMap(ctx, text)));
    } catch (err) {
      out.push(
        issue(
          "redirect-map-unreadable",
          "error",
          ctx.options.redirectsFile,
          `Cannot read the redirect map: ${(err as Error).message}`,
        ),
      );
    }
  }
  return out;
};

/** Parse "old,new" lines. Blank lines and lines starting with # are skipped, a header row is skipped. */
function parseMap(csv: string): { old: string; next: string; line: number }[] {
  const rows: { old: string; next: string; line: number }[] = [];
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const [old = "", next = ""] = cells;
    if (rows.length === 0 && /^old/i.test(old) && !/^(https?:)?\//i.test(old)) return;
    rows.push({ old, next, line: i + 1 });
  });
  return rows;
}

export async function checkRedirectMap(ctx: Context, csvText: string): Promise<Issue[]> {
  const out: Issue[] = [];
  const rows = parseMap(csvText);
  let ok = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      const oldUrl = row.old ? resolveUrl(row.old, ctx.origin + "/") : null;
      const newUrl = row.next ? resolveUrl(row.next, ctx.origin + "/") : null;
      if (!oldUrl || !newUrl) {
        failed++;
        out.push(
          issue("redirect-map-bad-row", "error", row.old || `line ${row.line}`, `Line ${row.line} is not a valid old,new pair`, {
            line: row.line,
          }),
        );
        return;
      }
      const first = await ctx.fetcher.fetchOnce(oldUrl);
      const problems: Issue[] = [];
      if (first.error) {
        problems.push(issue("redirect-map-fetch-failed", "error", oldUrl, `Request failed: ${first.error}`));
      } else if (!isRedirect(first.status) || !first.location) {
        problems.push(
          issue("redirect-map-no-redirect", "error", oldUrl, `Old URL answers ${first.status} instead of a redirect`, {
            expected: newUrl,
            status: first.status,
          }),
        );
      } else {
        if (first.status !== 301 && first.status !== 308) {
          problems.push(
            issue("redirect-map-wrong-status", "error", oldUrl, `Redirect is a ${first.status}, expected 301 or 308`, {
              status: first.status,
            }),
          );
        }
        if (normUrl(first.location) !== normUrl(newUrl)) {
          const chain = await ctx.fetcher.chain(oldUrl);
          problems.push(
            issue(
              "redirect-map-wrong-target",
              "error",
              oldUrl,
              `Redirects to ${first.location}, expected ${newUrl} in one hop`,
              { expected: newUrl, actual: first.location, hops: chainDetail(chain) },
            ),
          );
        }
      }
      const target = await ctx.fetcher.fetchOnce(newUrl);
      if (target.status !== 200) {
        problems.push(
          issue("redirect-map-target-status", "error", newUrl, `New URL answers ${target.status || target.error}, expected 200`, {
            old: oldUrl,
            status: target.status,
          }),
        );
      }
      if (problems.length) failed++;
      else ok++;
      out.push(...problems);
    }),
  );

  out.push(
    issue(
      "redirect-map-summary",
      "info",
      ctx.options.redirectsFile ?? "redirect map",
      `Redirect map: ${rows.length} rows, ${ok} correct, ${failed} with problems`,
      { total: rows.length, ok, failed },
    ),
  );
  return out;
}
