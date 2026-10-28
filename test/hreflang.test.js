import { test } from "node:test";
import assert from "node:assert/strict";
import { hreflang, validHreflang } from "../dist/checks/hreflang.js";
import { startServer, makeCtx, ids } from "./helpers/fixture-server-a.js";

const alt = (lang, href) => `<link rel="alternate" hreflang="${lang}" href="${href}">`;
const page = (head) => `<html><head>${head}</head><body></body></html>`;

test("validHreflang", () => {
  for (const ok of ["en", "en-GB", "pt-BR", "x-default", "zh-Hant-TW", "es-419"]) assert.ok(validHreflang(ok), ok);
  for (const bad of ["english", "en_GB", "e", "en-GBR", ""]) assert.ok(!validHreflang(bad), bad);
});

test("hreflang: good set gives no issues, pages without hreflang are skipped", async () => {
  const s = await startServer((b) => {
    const set = alt("en", `${b}/en`) + alt("fr", `${b}/fr`) + alt("x-default", `${b}/en`);
    return {
      "/en": page(set + `<link rel="canonical" href="${b}/en">`),
      "/fr": page(set + `<link rel="canonical" href="${b}/fr">`),
      "/plain": page(""),
    };
  });
  try {
    assert.deepEqual(await hreflang(makeCtx(s.base, ["/en", "/fr", "/plain"])), []);
  } finally {
    await s.close();
  }
});

test("hreflang: all issue ids from HTML", async () => {
  const s = await startServer((b) => ({
    "/en": page(alt("en", `${b}/en`) + alt("fr", `${b}/fr`) + alt("de", `${b}/de`) + alt("xx_YY", `${b}/bad`) + alt("es", `${b}/es`) + alt("it", `${b}/it`)),
    "/fr": page(alt("en", `${b}/en`) + alt("fr", `${b}/fr`)),
    "/de": page(alt("de", `${b}/de`)),
    "/es": { status: 404, body: "" },
    "/bad": page(""),
    "/it": page(alt("en", `${b}/en`) + alt("it", `${b}/it`) + `<link rel="canonical" href="${b}/it-main">`),
    "/noself": page(alt("fr", `${b}/fr`)),
  }));
  try {
    const issues = await hreflang(makeCtx(s.base, ["/en", "/noself"]));
    const en = ids(issues.filter((i) => i.url === s.base + "/en"));
    assert.deepEqual(en, [
      "hreflang-alternate-not-canonical",
      "hreflang-alternate-status",
      "hreflang-invalid-code",
      "hreflang-missing-return",
      "hreflang-missing-return",
      "hreflang-no-x-default",
    ]);
    // /bad has no hreflang at all so it does not return, /de does not list /en
    const miss = issues.filter((i) => i.id === "hreflang-missing-return" && i.url === s.base + "/en").map((i) => i.detail.href).sort();
    assert.deepEqual(miss, [s.base + "/bad", s.base + "/de"].sort());
    const ns = ids(issues.filter((i) => i.url === s.base + "/noself"));
    assert.ok(ns.includes("hreflang-no-self"));
    assert.ok(ns.includes("hreflang-no-x-default"));
    assert.equal(issues.find((i) => i.id === "hreflang-no-x-default").level, "warn");
    assert.equal(issues.find((i) => i.id === "hreflang-missing-return").level, "error");
  } finally {
    await s.close();
  }
});

test("hreflang: Link header and sitemap alternates, each alternate fetched once", async () => {
  const s = await startServer((b) => ({
    "/en": { headers: { link: `<${b}/en>; rel="alternate"; hreflang="en", <${b}/fr>; rel="alternate"; hreflang="fr", <${b}/en>; rel="alternate"; hreflang="x-default"` }, body: page("") },
    "/fr": page(""),
  }));
  try {
    const sm = new Map([[s.base + "/fr", [{ lang: "en", href: s.base + "/en" }, { lang: "fr", href: s.base + "/fr" }, { lang: "x-default", href: s.base + "/en" }]]]);
    const ctx = makeCtx(s.base, ["/en", "/fr"], { sitemapAlternates: sm });
    assert.deepEqual(await hreflang(ctx), []);
    assert.equal(ctx.fetcher.requests, 2);
  } finally {
    await s.close();
  }
});
