import { XMLParser } from "fast-xml-parser";
import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import type { Context, Page } from "./context.js";
import { bodyText } from "./fetch.js";
import type { Fetcher } from "./fetch.js";
import type { Options, PageSummary } from "./types.js";
import { normUrl, originOf, resolveUrl } from "./url.js";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  alternates: { lang: string; href: string }[];
}

/** One sitemap file as fetched and parsed. */
export interface SitemapFile {
  url: string;
  status: number;
  kind: "urlset" | "index" | "invalid" | "missing";
  /** Decompressed size in bytes. */
  bytes: number;
  entries: SitemapEntry[];
  /** Child sitemap URLs when kind is "index". */
  children: string[];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  parseTagValue: false,
  isArray: (name) => name === "url" || name === "sitemap" || name === "xhtml:link",
});

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && "#text" in v) return text((v as Record<string, unknown>)["#text"]);
  return undefined;
}

export async function readSitemap(fetcher: Fetcher, url: string): Promise<SitemapFile> {
  const res = await fetcher.fetchOnce(url);
  const base: SitemapFile = { url, status: res.status, kind: "missing", bytes: 0, entries: [], children: [] };
  if (res.status !== 200) return base;
  const body = bodyText(res);
  base.bytes = Buffer.byteLength(body);
  base.kind = "invalid";
  let doc: Record<string, unknown>;
  try {
    doc = xml.parse(body) as Record<string, unknown>;
  } catch {
    return base;
  }
  const urlset = doc["urlset"] as Record<string, unknown> | undefined;
  const index = doc["sitemapindex"] as Record<string, unknown> | undefined;
  if (urlset && typeof urlset === "object") {
    base.kind = "urlset";
    for (const u of (urlset["url"] as Record<string, unknown>[] | undefined) ?? []) {
      const loc = text(u["loc"]);
      if (!loc) continue;
      const alternates: { lang: string; href: string }[] = [];
      for (const l of (u["xhtml:link"] as Record<string, unknown>[] | undefined) ?? []) {
        const lang = l["@_hreflang"];
        const href = l["@_href"];
        if (l["@_rel"] === "alternate" && typeof lang === "string" && typeof href === "string") {
          alternates.push({ lang, href });
        }
      }
      base.entries.push({ loc, lastmod: text(u["lastmod"]), alternates });
    }
  } else if (index && typeof index === "object") {
    base.kind = "index";
    for (const s of (index["sitemap"] as Record<string, unknown>[] | undefined) ?? []) {
      const loc = text(s["loc"]);
      if (loc) base.children.push(loc);
    }
  }
  return base;
}

function robotsSitemaps(robotsTxt: string, origin: string): string[] {
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!m || !m[1]) continue;
    const abs = resolveUrl(m[1], origin + "/");
    if (abs && !out.includes(abs)) out.push(abs);
  }
  return out;
}

export async function buildContext(options: Options, fetcher: Fetcher): Promise<Context> {
  const origin = originOf(options.startUrl);
  const robotsRes = await fetcher.fetchOnce(origin + "/robots.txt");
  const robotsTxt = robotsRes.status === 200 ? bodyText(robotsRes) : "";

  let roots = robotsSitemaps(robotsTxt, origin);
  if (roots.length === 0) roots = [origin + "/sitemap.xml"];

  const sitemaps: string[] = [];
  const sitemapUrls: string[] = [];
  const sitemapAlternates = new Map<string, { lang: string; href: string }[]>();

  const addFile = (file: SitemapFile): void => {
    for (const e of file.entries) {
      sitemapUrls.push(e.loc);
      if (e.alternates.length > 0) {
        const key = normUrl(e.loc);
        sitemapAlternates.set(key, [...(sitemapAlternates.get(key) ?? []), ...e.alternates]);
      }
    }
  };

  const rootFiles = await Promise.all(roots.map((r) => readSitemap(fetcher, r)));
  const children: string[] = [];
  for (const f of rootFiles) {
    sitemaps.push(f.url);
    addFile(f);
    for (const c of f.children) {
      if (!roots.includes(c) && !children.includes(c)) children.push(c);
    }
  }
  const childFiles = await Promise.all(children.map((c) => readSitemap(fetcher, c)));
  for (const f of childFiles) {
    sitemaps.push(f.url);
    addFile(f);
  }

  const inSitemap = new Set(sitemapUrls.map(normUrl));
  const pages: Page[] = [];
  const seen = new Set<string>();
  const add = (url: string): void => {
    const key = normUrl(url);
    if (seen.has(key) || pages.length >= Math.max(1, options.maxPages)) return;
    try {
      if (originOf(key) !== origin) return;
    } catch {
      return;
    }
    seen.add(key);
    pages.push({ url: key, inSitemap: inSitemap.has(key) });
  };
  add(options.startUrl);
  for (const u of sitemapUrls) add(u);

  return { options, fetcher, origin, pages, sitemaps, sitemapUrls, sitemapAlternates, robotsTxt };
}

export interface HtmlInfo {
  title: string | undefined;
  h1Count: number;
  description: string | undefined;
  /** Visible words in the whole body, script/style/noscript excluded. */
  words: number;
  /** Words in <main> or <article> when present, else the same as `words`. */
  mainWords: number;
  /** Internal <a href> links (same origin as the page). */
  links: number;
  /** Known SPA root ids found in the markup, with whether each one is empty. */
  spaRoots: { id: string; empty: boolean }[];
  noindexMeta: boolean;
  canonical: string | undefined;
}

export const SPA_ROOT_IDS = ["__next", "root", "app", "__nuxt", "___gatsby"];

/** Text nodes joined with a space, so minified markup like <h1>A</h1><p>B</p> still counts two words. */
function spacedText(node: { childNodes: unknown[]; nodeType: number; rawText?: string }): string {
  if (node.nodeType === 3) return (node.rawText ?? "") + " ";
  return node.childNodes.map((c) => spacedText(c as typeof node)).join("");
}

function countWords(el: HTMLElement): number {
  return decodeEntities(spacedText(el)).split(/\s+/).filter(Boolean).length;
}

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ");
}

export function analyzeHtml(html: string, pageUrl: string): HtmlInfo {
  const root = parse(html);
  const title = root.querySelector("title")?.textContent.trim() || undefined;
  const description =
    root.querySelector('meta[name="description" i]')?.getAttribute("content")?.trim() || undefined;
  const h1Count = root.querySelectorAll("h1").length;
  const canonicalHref = root.querySelector('link[rel="canonical" i]')?.getAttribute("href");
  const canonical = canonicalHref ? (resolveUrl(canonicalHref, pageUrl) ?? canonicalHref) : undefined;

  let noindexMeta = false;
  for (const m of root.querySelectorAll("meta")) {
    const name = (m.getAttribute("name") ?? "").toLowerCase();
    if (name === "robots" || name === "googlebot") {
      if (/\b(noindex|none)\b/i.test(m.getAttribute("content") ?? "")) noindexMeta = true;
    }
  }

  const spaRoots: { id: string; empty: boolean }[] = [];
  for (const id of SPA_ROOT_IDS) {
    const el = root.getElementById(id);
    if (el) {
      const inner = el.clone() as HTMLElement;
      inner.querySelectorAll("script,style,noscript,template").forEach((n) => n.remove());
      spaRoots.push({ id, empty: inner.textContent.trim().length === 0 });
    }
  }

  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    // keep empty
  }
  let links = 0;
  for (const a of root.querySelectorAll("a[href]")) {
    const href = (a.getAttribute("href") ?? "").trim();
    if (href.startsWith("#")) continue;
    const abs = resolveUrl(href, pageUrl);
    if (abs && new URL(abs).origin === origin) links++;
  }

  root.querySelectorAll("script,style,noscript,template").forEach((n) => n.remove());
  const body = root.querySelector("body") ?? root;
  const words = countWords(body as HTMLElement);
  const main = root.querySelector("main") ?? root.querySelector("article");
  const mainWords = main ? countWords(main) : words;

  return { title, h1Count, description, words, mainWords, links, spaRoots, noindexMeta, canonical };
}

export interface LoadedPage {
  summary: PageSummary;
  html: string;
  headers: Record<string, string>;
  /** Parsed from the final response when it is a 200, else undefined. */
  info: HtmlInfo | undefined;
}

const loaded = new WeakMap<Fetcher, Map<string, Promise<LoadedPage>>>();

/** Follow redirects from `url`, parse the final raw HTML. Cached per fetcher and URL. */
export function loadPage(ctx: Context, url: string): Promise<LoadedPage> {
  let perFetcher = loaded.get(ctx.fetcher);
  if (!perFetcher) {
    perFetcher = new Map();
    loaded.set(ctx.fetcher, perFetcher);
  }
  const key = normUrl(url);
  let hit = perFetcher.get(key);
  if (!hit) {
    hit = (async (): Promise<LoadedPage> => {
      const chain = await ctx.fetcher.chain(key);
      const html = chain.final.error ? "" : bodyText(chain.final);
      // Non-HTML resources (JSON, images) in a sitemap are not pages: skip the HTML checks for them.
      const type = (chain.final.headers["content-type"] ?? "").toLowerCase();
      const isHtml = type === "" || type.includes("html");
      const ok = chain.status === 200 && isHtml;
      const info = ok ? analyzeHtml(html, chain.finalUrl) : undefined;
      return {
        summary: {
          url: key,
          status: chain.status,
          finalUrl: chain.finalUrl,
          words: info?.words ?? 0,
          links: info?.links ?? 0,
        },
        html,
        headers: chain.final.headers,
        info,
      };
    })();
    perFetcher.set(key, hit);
  }
  return hit;
}

export async function pageSummary(ctx: Context, url: string): Promise<PageSummary> {
  return (await loadPage(ctx, url)).summary;
}

export function pageSummaries(ctx: Context): Promise<PageSummary[]> {
  return Promise.all(ctx.pages.map((p) => pageSummary(ctx, p.url)));
}
