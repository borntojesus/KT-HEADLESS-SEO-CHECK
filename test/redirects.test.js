import { test } from "node:test";
import assert from "node:assert/strict";
import { redirects, checkRedirectMap } from "../dist/checks/redirects.js";
import { startServer, makeCtx, ids } from "./helpers/fixture-server-a.js";

const redir = (status, to) => ({ status, headers: { location: to } });

test("redirects: clean page gives no issues", async () => {
  const s = await startServer({ "/": "<html></html>" });
  try {
    assert.deepEqual(await redirects(makeCtx(s.base, ["/"])), []);
  } finally {
    await s.close();
  }
});

test("redirects: every page level issue", async () => {
  const s = await startServer((b) => ({
    "/loop-a": redir(301, "/loop-b"),
    "/loop-b": redir(301, "/loop-a"),
    "/long": redir(301, "/l1"),
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/l${i + 1}`, redir(301, `/l${i + 2}`)])),
    "/gone": { status: 404, body: "x" },
    "/two": redir(301, "/two-b"),
    "/two-b": redir(301, "/two-c"),
    "/two-c": "ok",
    "/temp": redir(302, "/temp/"),
    "/temp/": "ok",
    "/dead": redir(301, "http://127.0.0.1:1/x"),
  }));
  try {
    const ctx = makeCtx(s.base, ["/loop-a", "/long", "/gone", "/two", "/temp", "/dead"]);
    const issues = await redirects(ctx);
    const by = (id) => issues.filter((i) => i.id === id);
    assert.equal(by("redirect-loop").length, 1);
    assert.equal(by("redirect-too-long").length, 1);
    assert.equal(by("redirect-final-status").length, 1);
    assert.equal(by("redirect-multiple-hops").length, 1);
    assert.equal(by("redirect-temporary").length, 1);
    assert.equal(by("redirect-temporary")[0].level, "warn");
    assert.equal(by("redirect-fetch-failed").length, 1);
  } finally {
    await s.close();
  }
});

test("redirects: mixed http hop", async () => {
  const s = await startServer({ "/": "ok" });
  try {
    const ctx = makeCtx(s.base, ["/"]);
    // fake an https page chain that downgrades to http
    ctx.fetcher.chain = async () => ({
      url: "https://a.test/",
      hops: [
        { url: "https://a.test/", status: 301, location: "http://a.test/x" },
        { url: "http://a.test/x", status: 200 },
      ],
      finalUrl: "http://a.test/x",
      status: 200,
      final: {},
      loop: false,
      tooLong: false,
    });
    assert.deepEqual(ids(await redirects(ctx)), ["redirect-mixed-http"]);
  } finally {
    await s.close();
  }
});

test("redirect map: good and bad rows", async () => {
  const s = await startServer({
    "/old-ok": redir(301, "/new-ok"),
    "/new-ok": "ok",
    "/old-308": redir(308, "/new-ok"),
    "/old-302": redir(302, "/new-ok"),
    "/old-none": "still here",
    "/old-wrong": redir(301, "/elsewhere"),
    "/elsewhere": "ok",
    "/old-dead": redir(301, "/new-404"),
    "/old-hop": redir(301, "/mid"),
    "/mid": redir(301, "/new-ok"),
  });
  try {
    const ctx = makeCtx(s.base, ["/new-ok"]);
    const csv = [
      "old,new",
      "# comment",
      "/old-ok,/new-ok",
      `${s.base}/old-308,${s.base}/new-ok`,
      "/old-302,/new-ok",
      "/old-none,/new-ok",
      "/old-wrong,/new-ok",
      "/old-dead,/new-404",
      "/old-hop,/new-ok",
      "justonecolumn",
      "",
    ].join("\n");
    const issues = await checkRedirectMap(ctx, csv);
    const by = (id) => issues.filter((i) => i.id === id);
    assert.equal(by("redirect-map-wrong-status").length, 1);
    assert.equal(by("redirect-map-no-redirect").length, 1);
    assert.equal(by("redirect-map-wrong-target").length, 2);
    assert.equal(by("redirect-map-target-status").length, 1);
    assert.equal(by("redirect-map-bad-row").length, 1);
    const sum = by("redirect-map-summary")[0];
    assert.equal(sum.level, "info");
    assert.equal(sum.detail.total, 8);
    assert.equal(sum.detail.ok, 2);
  } finally {
    await s.close();
  }
});

test("redirects: reads redirectsFile and reports unreadable", async () => {
  const s = await startServer({ "/": "ok" });
  try {
    const ctx = makeCtx(s.base, ["/"], { options: { redirectsFile: "/nonexistent/map.csv" } });
    assert.deepEqual(ids(await redirects(ctx)), ["redirect-map-unreadable"]);
  } finally {
    await s.close();
  }
});
