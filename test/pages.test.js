import { test } from "node:test";
import assert from "node:assert/strict";
import { Fetcher } from "../dist/fetch.js";
import { buildContext, pageSummary, analyzeHtml } from "../dist/pages.js";
import { startServer, makeOptions } from "./helpers/fixture-server-b.js";

const fetcher = () => new Fetcher({ timeout: 5000, userAgent: "test", concurrency: 4 });
const xmlHeaders = { "content-type": "application/xml" };
const urlset = (urls, extra = "") =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls
    .map((u) => `<url><loc>${u}</loc>${extra}</url>`)
    .join("")}</urlset>`;

test("sitemap lines in robots.txt, start URL first, other origins dropped", async () => {
  const srv = await startServer({
    "/robots.txt": (req) => `User-agent: *\nAllow: /\nSitemap: http://${req.headers.host}/map.xml\n`,
    "/map.xml": (req) =>
      ({ headers: xmlHeaders, body: urlset([`http://${req.headers.host}/a`, `http://${req.headers.host}/b`, "https://other.example/x"]) }),
  });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/"), fetcher());
    assert.equal(ctx.sitemaps.length, 1);
    assert.equal(ctx.sitemapUrls.length, 3);
    assert.deepEqual(ctx.pages.map((p) => p.url), [srv.url + "/", srv.url + "/a", srv.url + "/b"]);
    assert.equal(ctx.pages[0].inSitemap, false);
    assert.equal(ctx.pages[1].inSitemap, true);
    assert.match(ctx.robotsTxt, /Sitemap/);
  } finally {
    await srv.close();
  }
});

test("fallback to /sitemap.xml, maxPages limit, start URL kept when in sitemap", async () => {
  const srv = await startServer({
    "/sitemap.xml": (req) =>
      ({ headers: xmlHeaders, body: urlset([1, 2, 3, 4, 5].map((n) => `http://${req.headers.host}/p${n}`)) }),
  });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/p3", { maxPages: 3 }), fetcher());
    assert.deepEqual(ctx.sitemaps, [srv.url + "/sitemap.xml"]);
    assert.equal(ctx.robotsTxt, "");
    assert.deepEqual(ctx.pages.map((p) => p.url), [srv.url + "/p3", srv.url + "/p1", srv.url + "/p2"]);
    assert.equal(ctx.pages[0].inSitemap, true);
    assert.equal(ctx.sitemapUrls.length, 5);
  } finally {
    await srv.close();
  }
});

test("sitemap index is followed one level and hreflang alternates are collected", async () => {
  const srv = await startServer({
    "/sitemap.xml": (req) => ({
      headers: xmlHeaders,
      body: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://${req.headers.host}/s1.xml</loc></sitemap><sitemap><loc>http://${req.headers.host}/s2.xml</loc></sitemap></sitemapindex>`,
    }),
    "/s1.xml": (req) => ({
      headers: xmlHeaders,
      body: urlset(
        [`http://${req.headers.host}/en`],
        `<xhtml:link rel="alternate" hreflang="en" href="http://${req.headers.host}/en"/><xhtml:link rel="alternate" hreflang="de" href="http://${req.headers.host}/de"/>`,
      ),
    }),
    "/s2.xml": (req) => ({ headers: xmlHeaders, body: urlset([`http://${req.headers.host}/de`]) }),
  });
  try {
    const f = fetcher();
    const ctx = await buildContext(makeOptions(srv.url + "/"), f);
    assert.equal(ctx.sitemaps.length, 3);
    assert.deepEqual(ctx.sitemapUrls, [srv.url + "/en", srv.url + "/de"]);
    const alts = ctx.sitemapAlternates.get(srv.url + "/en");
    assert.deepEqual(alts, [
      { lang: "en", href: srv.url + "/en" },
      { lang: "de", href: srv.url + "/de" },
    ]);
  } finally {
    await srv.close();
  }
});

test("no sitemap at all gives only the start URL", async () => {
  const srv = await startServer({});
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/"), fetcher());
    assert.deepEqual(ctx.pages.map((p) => p.url), [srv.url + "/"]);
    assert.deepEqual(ctx.sitemapUrls, []);
  } finally {
    await srv.close();
  }
});

test("pageSummary counts visible words and internal links, ignores script/style/noscript", async () => {
  const html = `<html><head><title>T</title><style>.a{color:red}</style></head><body>
    <script>var x = "one two three";</script><noscript>hidden words here</noscript>
    <h1>Hello world</h1><p>alpha beta gamma</p>
    <a href="/a">a</a> <a href="#top">top</a> <a href="mailto:x@y.z">m</a> <a href="https://other.example/">ext</a></body></html>`;
  const srv = await startServer({ "/": { headers: { "content-type": "text/html" }, body: html } });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/"), fetcher());
    const s = await pageSummary(ctx, srv.url + "/");
    assert.equal(s.status, 200);
    assert.equal(s.finalUrl, srv.url + "/");
    assert.equal(s.words, 9); // 5 words of text plus the 4 link texts
    assert.equal(s.links, 1); // only /a: fragment, mailto and other origin do not count
  } finally {
    await srv.close();
  }
});

test("pageSummary follows redirects and reports non-200", async () => {
  const srv = await startServer({
    "/old": { status: 301, headers: { location: "/new" } },
    "/new": "<html><body><h1>New page</h1></body></html>",
  });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/old"), fetcher());
    const s = await pageSummary(ctx, srv.url + "/old");
    assert.equal(s.status, 200);
    assert.equal(s.finalUrl, srv.url + "/new");
    const miss = await pageSummary(ctx, srv.url + "/missing");
    assert.equal(miss.status, 404);
    assert.equal(miss.words, 0);
  } finally {
    await srv.close();
  }
});

test("analyzeHtml finds SPA roots and noindex", () => {
  const info = analyzeHtml(
    '<html><head><meta name="robots" content="noindex, follow"></head><body><div id="root"></div></body></html>',
    "http://x.test/",
  );
  assert.equal(info.noindexMeta, true);
  assert.deepEqual(info.spaRoots, [{ id: "root", empty: true }]);
});

test("a non-HTML resource gets no HTML analysis, so HTML checks skip it", async () => {
  const { loadPage } = await import("../dist/pages.js");
  const srv = await startServer({
    "/data": { headers: { "content-type": "application/json" }, body: '{"a":1}' },
    "/page": { headers: { "content-type": "text/html; charset=utf-8" }, body: "<html><title>x</title><h1>x</h1></html>" },
  });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/page"), fetcher());
    assert.equal((await loadPage(ctx, srv.url + "/data")).info, undefined);
    assert.ok((await loadPage(ctx, srv.url + "/page")).info);
  } finally {
    await srv.close();
  }
});
