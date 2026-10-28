import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/fixture-server-b.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const xml = { "content-type": "application/xml" };
const html = { "content-type": "text/html; charset=utf-8" };

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const goodPage = (self, extra = "") =>
  `<html><head><title>T</title><meta name="description" content="d"><link rel="canonical" href="${self}">${extra}</head>` +
  `<body><h1>Hello</h1><p>${words(200)}</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body></html>`;

let good;
let warnOnly;
let bad;

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  // Healthy site: no errors, no warnings.
  good = await startServer({
    "/robots.txt": (req) => `User-agent: *\nAllow: /\nSitemap: http://${req.headers.host}/sitemap.xml\n`,
    "/sitemap.xml": (req) => ({
      headers: xml,
      body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://${req.headers.host}/</loc></url><url><loc>http://${req.headers.host}/a</loc></url></urlset>`,
    }),
    "/": (req) => ({ headers: html, body: goodPage(`http://${req.headers.host}/`) }),
    "/a": (req) => ({ headers: html, body: goodPage(`http://${req.headers.host}/a`) }),
  });
  // Warnings only: page without a canonical.
  warnOnly = await startServer({
    "/robots.txt": (req) => `User-agent: *\nAllow: /\nSitemap: http://${req.headers.host}/sitemap.xml\n`,
    "/sitemap.xml": (req) => ({
      headers: xml,
      body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://${req.headers.host}/</loc></url></urlset>`,
    }),
    "/": { headers: html, body: goodPage("").replace(/<link rel="canonical"[^>]*>/, "") },
  });
  // Errors: empty SPA shell, sitemap URL that 404s.
  bad = await startServer({
    "/robots.txt": (req) => `User-agent: *\nAllow: /\nSitemap: http://${req.headers.host}/sitemap.xml\n`,
    "/sitemap.xml": (req) => ({
      headers: xml,
      body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://${req.headers.host}/</loc></url><url><loc>http://${req.headers.host}/gone</loc></url></urlset>`,
    }),
    "/": { headers: html, body: '<html><head></head><body><div id="__next"></div></body></html>' },
  });
});

after(async () => {
  await Promise.all([good.close(), warnOnly.close(), bad.close()]);
});

test("--json prints the documented shape and exits 0 on a healthy site", async () => {
  const r = await run([good.url + "/", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(report), ["version", "startUrl", "pages", "issues", "summary"]);
  assert.deepEqual(Object.keys(report.summary), ["errors", "warnings", "info"]);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 0);
  assert.equal(report.pages.length, 2);
  assert.deepEqual(Object.keys(report.pages[0]), ["url", "status", "finalUrl", "words", "links"]);
  assert.equal(report.pages[0].status, 200);
  assert.ok(report.pages[0].words > 100);
});

test("JSON output is identical across runs and issues are sorted", async () => {
  const a = await run([bad.url + "/", "--json", "--fail-on", "never"]);
  const b = await run([bad.url + "/", "--json", "--fail-on", "never"]);
  assert.equal(a.stdout, b.stdout);
  const { issues } = JSON.parse(a.stdout);
  assert.ok(issues.length > 0);
  const order = ["redirects", "canonical", "hreflang", "sitemap", "nojs", "robots"];
  for (let i = 1; i < issues.length; i++) {
    const p = issues[i - 1];
    const c = issues[i];
    const key = (x) => [order.indexOf(x.check), x.url, x.id];
    const [pk, ck] = [key(p), key(c)];
    const cmp = pk[0] - ck[0] || (pk[1] < ck[1] ? -1 : pk[1] > ck[1] ? 1 : 0) || (pk[2] < ck[2] ? -1 : pk[2] > ck[2] ? 1 : 0);
    assert.ok(cmp <= 0, `${p.check}/${p.url}/${p.id} before ${c.check}/${c.url}/${c.id}`);
  }
});

test("--only limits the checks that run", async () => {
  const r = await run([bad.url + "/", "--json", "--only", "nojs", "--fail-on", "never"]);
  const { issues } = JSON.parse(r.stdout);
  assert.ok(issues.length > 0);
  assert.ok(issues.every((i) => i.check === "nojs"));
  assert.ok(issues.some((i) => i.id === "nojs-empty-spa"));
});

test("errors exit 1, and --fail-on never turns that into 0", async () => {
  const failing = await run([bad.url + "/"]);
  assert.equal(failing.code, 1);
  assert.match(failing.stdout, /\d+ errors, \d+ warnings, 2 pages\n$/);
  assert.doesNotMatch(failing.stdout, /\x1b\[/); // NO_COLOR and not a TTY
  const never = await run([bad.url + "/", "--fail-on", "never"]);
  assert.equal(never.code, 0);
});

test("--fail-on warn exits 1 on warnings only, default exits 0", async () => {
  const dflt = await run([warnOnly.url + "/", "--json"]);
  assert.equal(dflt.code, 0);
  const summary = JSON.parse(dflt.stdout).summary;
  assert.equal(summary.errors, 0);
  assert.ok(summary.warnings > 0);
  const strict = await run([warnOnly.url + "/", "--json", "--fail-on", "warn"]);
  assert.equal(strict.code, 1);
});

test("usage errors exit 2", async () => {
  for (const args of [
    [],
    ["not a url"],
    ["ftp://example.com"],
    [good.url + "/", "--only", "nonsense"],
    [good.url + "/", "--fail-on", "sometimes"],
    [good.url + "/", "--max-pages", "0"],
    [good.url + "/", "--bogus-flag"],
  ]) {
    const r = await run(args);
    assert.equal(r.code, 2, `args: ${args.join(" ")}`);
    assert.ok(r.stderr.length > 0);
  }
});

test("an unreachable start URL exits 2", async () => {
  const r = await run(["http://127.0.0.1:1/", "--timeout", "2000"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Cannot reach/);
});

test("--help and --version exit 0", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--fail-on/);
  const version = await run(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("--redirects checks a migration map", async () => {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "hsc-"));
  const file = join(dir, "map.csv");
  const srv = await startServer({
    "/old": { status: 301, headers: { location: "/new" } },
    "/new": { headers: html, body: goodPage("") },
    "/": { headers: html, body: goodPage("") },
  });
  try {
    writeFileSync(file, "old,new\n/old,/new\n/missing,/new\n");
    const r = await run([srv.url + "/", "--json", "--only", "redirects", "--redirects", file, "--fail-on", "never"]);
    const { issues } = JSON.parse(r.stdout);
    assert.ok(issues.some((i) => i.id === "redirect-map-no-redirect"));
    assert.ok(issues.some((i) => i.id === "redirect-map-summary"));
  } finally {
    await srv.close();
  }
});
