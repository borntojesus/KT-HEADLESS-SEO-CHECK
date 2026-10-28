import { test } from "node:test";
import assert from "node:assert/strict";
import { Fetcher } from "../dist/fetch.js";
import { buildContext } from "../dist/pages.js";
import { sitemap } from "../dist/checks/sitemap.js";
import { startServer, makeOptions } from "./helpers/fixture-server-b.js";

const xh = { "content-type": "application/xml" };
const page = (extra = "", body = "<h1>x</h1>") => ({
  headers: { "content-type": "text/html" },
  body: `<html><head><title>t</title>${extra}</head><body>${body}</body></html>`,
});
const urlset = (entries) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries
    .map((e) => (typeof e === "string" ? `<url><loc>${e}</loc></url>` : `<url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`))
    .join("")}</urlset>`;

async function run(routes, opts = {}) {
  const srv = await startServer(routes);
  try {
    const ctx = await buildContext(
      makeOptions(srv.url + "/", opts),
      new Fetcher({ timeout: 5000, userAgent: "test", concurrency: 4 }),
    );
    return { issues: await sitemap(ctx), srv, ctx };
  } finally {
    await srv.close();
  }
}
const ids = (issues) => issues.map((i) => i.id).sort();

test("healthy sitemap listed in robots gives only the info summary", async () => {
  const { issues } = await run({
    "/robots.txt": (req) => `User-agent: *\nSitemap: http://${req.headers.host}/sitemap.xml\n`,
    "/sitemap.xml": (req) => ({ headers: xh, body: urlset([{ loc: `http://${req.headers.host}/a`, lastmod: "2026-01-31" }]) }),
    "/": page(),
    "/a": page(),
  });
  assert.deepEqual(ids(issues), ["sitemap-summary"]);
  assert.equal(issues[0].level, "info");
});

test("sitemap-missing when there is no sitemap", async () => {
  const { issues } = await run({ "/": page() });
  assert.deepEqual(ids(issues), ["sitemap-missing"]);
  assert.equal(issues[0].level, "error");
});

test("sitemap-not-xml for an HTML response", async () => {
  const { issues } = await run({ "/sitemap.xml": "<html><body>hello</body></html>", "/": page() });
  assert.ok(ids(issues).includes("sitemap-not-xml"));
});

test("sitemap-not-in-robots warns when found only by fallback", async () => {
  const { issues } = await run({
    "/sitemap.xml": (req) => ({ headers: xh, body: urlset([`http://${req.headers.host}/a`]) }),
    "/": page(),
    "/a": page(),
  });
  assert.deepEqual(ids(issues), ["sitemap-not-in-robots", "sitemap-summary"]);
  assert.equal(issues.find((i) => i.id === "sitemap-not-in-robots").level, "warn");
});

test("URL problems: status, redirect, noindex (meta and header), canonical elsewhere", async () => {
  const { issues } = await run({
    "/robots.txt": (req) => `Sitemap: http://${req.headers.host}/sitemap.xml`,
    "/sitemap.xml": (req) => ({
      headers: xh,
      body: urlset(["gone", "moved", "meta-noindex", "header-noindex", "canon", "fine"].map((p) => `http://${req.headers.host}/${p}`)),
    }),
    "/": page(),
    "/moved": { status: 301, headers: { location: "/fine" } },
    "/meta-noindex": page('<meta name="robots" content="noindex">'),
    "/header-noindex": { status: 200, headers: { "content-type": "text/html", "x-robots-tag": "noindex" }, body: "<html><body>x</body></html>" },
    "/canon": page('<link rel="canonical" href="/fine">'),
    "/fine": page('<link rel="canonical" href="/fine">'),
  });
  const by = (id) => issues.filter((i) => i.id === id).map((i) => new URL(i.url).pathname);
  assert.deepEqual(by("sitemap-url-status"), ["/gone"]);
  assert.deepEqual(by("sitemap-url-redirect"), ["/moved"]);
  assert.deepEqual(by("sitemap-url-noindex").sort(), ["/header-noindex", "/meta-noindex"]);
  assert.deepEqual(by("sitemap-url-canonical"), ["/canon"]);
  assert.ok(!issues.some((i) => i.url.endsWith("/fine") && i.level === "error"));
});

test("bad lastmod values are reported with examples", async () => {
  const { issues } = await run({
    "/robots.txt": (req) => `Sitemap: http://${req.headers.host}/sitemap.xml`,
    "/sitemap.xml": (req) => ({
      headers: xh,
      body: urlset([
        { loc: `http://${req.headers.host}/a`, lastmod: "yesterday" },
        { loc: `http://${req.headers.host}/b`, lastmod: "2026-02-30" },
        { loc: `http://${req.headers.host}/c`, lastmod: "2026-03-01T10:00:00+02:00" },
      ]),
    }),
    "/": page(), "/a": page(), "/b": page(), "/c": page(),
  });
  const bad = issues.find((i) => i.id === "sitemap-bad-lastmod");
  assert.ok(bad);
  assert.equal(bad.level, "warn");
  assert.equal(bad.detail.examples.length, 2);
});

test("more than 50,000 URLs in one file warns", async () => {
  const origin = "http://example.test";
  const body = urlset(Array.from({ length: 50_001 }, (_, i) => `${origin}/p${i}`));
  const { issues } = await run({
    "/robots.txt": (req) => `Sitemap: http://${req.headers.host}/sitemap.xml`,
    "/sitemap.xml": { headers: xh, body },
    "/": page(),
  });
  assert.ok(ids(issues).includes("sitemap-too-many-urls"));
});

test("a sitemap over 50 MB warns", async () => {
  const body = urlset(["http://example.test/a"]) + " ".repeat(51 * 1024 * 1024);
  const { issues } = await run({
    "/robots.txt": (req) => `Sitemap: http://${req.headers.host}/sitemap.xml`,
    "/sitemap.xml": { headers: xh, body },
    "/": page(),
  });
  assert.ok(ids(issues).includes("sitemap-too-large"));
});

test("sitemap index: children are checked and counted, maxPages limits the URL checks", async () => {
  const { issues, ctx } = await run(
    {
      "/robots.txt": (req) => `Sitemap: http://${req.headers.host}/index.xml`,
      "/index.xml": (req) => ({
        headers: xh,
        body: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://${req.headers.host}/c1.xml</loc></sitemap><sitemap><loc>http://${req.headers.host}/c2.xml</loc></sitemap></sitemapindex>`,
      }),
      "/c1.xml": (req) => ({ headers: xh, body: urlset([`http://${req.headers.host}/a`, `http://${req.headers.host}/b`]) }),
      "/c2.xml": (req) => ({ headers: xh, body: urlset([`http://${req.headers.host}/c`]) }),
      "/": page(), "/a": page(), "/b": page(), "/c": page(),
    },
    { maxPages: 3 },
  );
  assert.equal(ctx.pages.length, 3);
  const summary = issues.find((i) => i.id === "sitemap-summary");
  assert.deepEqual(summary.detail, { files: 3, urls: 3, sampled: 2 });
  assert.equal(issues.filter((i) => i.level === "error").length, 0);
});
