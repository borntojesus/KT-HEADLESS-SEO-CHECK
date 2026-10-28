import { test } from "node:test";
import assert from "node:assert/strict";
import { Fetcher } from "../dist/fetch.js";
import { buildContext } from "../dist/pages.js";
import { nojs } from "../dist/checks/nojs.js";
import { startServer, makeOptions } from "./helpers/fixture-server-b.js";

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const html = (head, body, headers = {}) => ({
  headers: { "content-type": "text/html", ...headers },
  body: `<html><head>${head}</head><body>${body}</body></html>`,
});
const links = '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>';

async function run(routes) {
  const srv = await startServer(routes);
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/"), new Fetcher({ timeout: 5000, userAgent: "test", concurrency: 4 }));
    return await nojs(ctx);
  } finally {
    await srv.close();
  }
}
const ids = (issues) => issues.map((i) => i.id).sort();

test("a complete server rendered page has no issues", async () => {
  const issues = await run({
    "/": html('<title>Home</title><meta name="description" content="d">', `<main><h1>Home</h1><p>${words(200)}</p>${links}</main>`),
  });
  assert.deepEqual(issues, []);
});

test("empty Next.js shell: no title, no h1, empty SPA root", async () => {
  const issues = await run({ "/": html("", '<div id="__next"></div><script src="/app.js"></script>') });
  assert.deepEqual(ids(issues), ["nojs-empty-spa", "nojs-few-links", "nojs-no-description", "nojs-no-h1", "nojs-no-title"]);
  assert.equal(issues.find((i) => i.id === "nojs-empty-spa").level, "error");
  assert.equal(issues.find((i) => i.id === "nojs-no-title").level, "error");
});

test("every known SPA root id counts", async () => {
  for (const id of ["root", "app", "__nuxt", "___gatsby"]) {
    const issues = await run({ "/": html("<title>t</title>", `<h1>x</h1><div id="${id}"></div>`) });
    assert.ok(ids(issues).includes("nojs-empty-spa"), id);
  }
});

test("a filled SPA root with enough text is not flagged as empty", async () => {
  const issues = await run({
    "/": html("<title>t</title><meta name=description content=d>", `<div id="root"><h1>Hi</h1><p>${words(200)}</p>${links}</div>`),
  });
  assert.deepEqual(issues, []);
});

test("few words without SPA root is thin content, not an error", async () => {
  const issues = await run({ "/": html("<title>t</title>", `<h1>Hi</h1><p>${words(40)}</p>${links}`) });
  assert.deepEqual(ids(issues), ["nojs-no-description", "nojs-thin-content"]);
  assert.ok(issues.every((i) => i.level === "warn"));
});

test("script, style and noscript text is not counted", async () => {
  const issues = await run({
    "/": html("<title>t</title><style>x</style>", `<h1>Hi</h1><script>${words(500)}</script><noscript>${words(500)}</noscript>${links}`),
  });
  assert.ok(ids(issues).includes("nojs-thin-content"));
});

test("noindex via meta robots is a warning for a sitemap page", async () => {
  const srv = await startServer({
    "/sitemap.xml": (req) => ({
      headers: { "content-type": "application/xml" },
      body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://${req.headers.host}/n</loc></url></urlset>`,
    }),
    "/": html("<title>t</title><meta name=description content=d>", `<h1>x</h1><p>${words(200)}</p>${links}`),
    "/n": html('<title>t</title><meta name="description" content="d"><meta name="robots" content="noindex">', `<h1>x</h1><p>${words(200)}</p>${links}`),
  });
  try {
    const ctx = await buildContext(makeOptions(srv.url + "/"), new Fetcher({ timeout: 5000, userAgent: "test", concurrency: 4 }));
    const issues = await nojs(ctx);
    const n = issues.find((i) => i.id === "nojs-noindex");
    assert.equal(n.level, "warn");
    assert.ok(n.url.endsWith("/n"));
  } finally {
    await srv.close();
  }
});

test("noindex via X-Robots-Tag on a page outside the sitemap is info", async () => {
  const issues = await run({
    "/": html("<title>t</title><meta name=description content=d>", `<h1>x</h1><p>${words(200)}</p>${links}`, { "x-robots-tag": "noindex" }),
  });
  assert.deepEqual(ids(issues), ["nojs-noindex"]);
  assert.equal(issues[0].level, "info");
});

test("non-200 pages are skipped", async () => {
  const issues = await run({ "/": { status: 500, body: "boom" } });
  assert.deepEqual(issues, []);
});
