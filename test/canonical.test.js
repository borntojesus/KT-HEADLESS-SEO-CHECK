import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, parseLinkHeader } from "../dist/checks/canonical.js";
import { startServer, makeCtx, ids } from "./helpers/fixture-server-a.js";

const page = (head) => `<html><head>${head}</head><body><h1>x</h1></body></html>`;

test("parseLinkHeader", () => {
  const l = parseLinkHeader('<https://a.test/x>; rel="canonical", <https://a.test/fr>; rel="alternate"; hreflang="fr"');
  assert.equal(l.length, 2);
  assert.equal(l[0].params.rel, "canonical");
  assert.equal(l[1].params.hreflang, "fr");
});

test("canonical: self canonical is fine", async () => {
  const s = await startServer((b) => ({
    "/a": page(`<link rel="canonical" href="${b}/a"><meta property="og:url" content="${b}/a">`),
  }));
  try {
    assert.deepEqual(await canonical(makeCtx(s.base, ["/a"])), []);
  } finally {
    await s.close();
  }
});

test("canonical: all issue ids", async () => {
  const s = await startServer((b) => ({
    "/missing": page(""),
    "/multi": page(`<link rel="canonical" href="${b}/multi"><link rel="canonical" href="${b}/other-ok">`),
    "/relative": page(`<link rel="canonical" href="/relative">`),
    "/noindex": page(`<link rel="canonical" href="${b}/noindex"><meta name="robots" content="noindex">`),
    "/og": page(`<link rel="canonical" href="${b}/og"><meta property="og:url" content="${b}/different">`),
    "/to-404": page(`<link rel="canonical" href="${b}/nope">`),
    "/to-redirect": page(`<link rel="canonical" href="${b}/redir">`),
    "/redir": { status: 301, headers: { location: "/other-ok" } },
    "/to-noindex": page(`<link rel="canonical" href="${b}/target-noindex">`),
    "/target-noindex": { headers: { "x-robots-tag": "noindex" }, body: page("") },
    "/to-other": page(`<link rel="canonical" href="${b}/other-ok">`),
    "/other-ok": page(`<link rel="canonical" href="${b}/other-ok">`),
    "/empty": page(`<link rel="canonical" href="">`),
    "/header": { headers: { link: `<${b}/header>; rel="canonical"` }, body: page("") },
    "/header-conflict": { headers: { link: `<${b}/other-ok>; rel="canonical"` }, body: page(`<link rel="canonical" href="${b}/header-conflict">`) },
  }));
  try {
    const paths = ["/missing", "/multi", "/relative", "/noindex", "/og", "/to-404", "/to-redirect", "/to-noindex", "/to-other", "/empty", "/header", "/header-conflict"];
    const issues = await canonical(makeCtx(s.base, paths));
    const forPath = (p) => ids(issues.filter((i) => i.url === s.base + p));
    assert.deepEqual(forPath("/missing"), ["canonical-missing"]);
    assert.ok(forPath("/multi").includes("canonical-multiple"));
    assert.deepEqual(forPath("/relative"), ["canonical-relative"]);
    assert.deepEqual(forPath("/noindex"), ["canonical-noindex"]);
    assert.deepEqual(forPath("/og"), ["canonical-og-mismatch"]);
    assert.deepEqual(forPath("/to-404"), ["canonical-target-status"]);
    assert.deepEqual(forPath("/to-redirect"), ["canonical-target-status"]);
    assert.deepEqual(forPath("/to-noindex"), ["canonical-target-noindex"]);
    assert.deepEqual(forPath("/to-other"), ["canonical-other"]);
    assert.equal(issues.find((i) => i.id === "canonical-other").level, "info");
    assert.deepEqual(forPath("/empty"), ["canonical-invalid"]);
    assert.deepEqual(forPath("/header"), []);
    assert.ok(forPath("/header-conflict").includes("canonical-multiple"));
    assert.equal(issues.find((i) => i.id === "canonical-multiple").level, "error");
  } finally {
    await s.close();
  }
});
