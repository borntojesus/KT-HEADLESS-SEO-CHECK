# headless-seo-check: spec v0.1

Date: 2026-10-28. Owner: Dmytro Antonyuk. Public repo, MIT.

## Why

Headless and JS framework sites (Next.js, Nuxt, Astro, Remix, SPA) break technical SEO in the same five
places: redirect chains after a migration, wrong canonicals, broken hreflang clusters, sitemaps full of
redirects and noindex pages, and HTML that is empty until JavaScript runs. Search crawlers render JS late
and AI crawlers (GPTBot, ClaudeBot, PerplexityBot) mostly do not render it at all. Existing tools are
either paid desktop crawlers or generic Lighthouse runs. This is a small, fast CLI you run with `npx` or
in CI. It is also the public proof for the brand goal "the headless technical SEO person" (see
BR-CONTENT-LAB `docs/challenge/strategy.md` §1.1a).

## Usage

```sh
npx headless-seo-check https://example.com                 # start URL + sitemap sample
npx headless-seo-check https://example.com --max-pages 50 --json > report.json
npx headless-seo-check https://new.example.com --redirects map.csv   # migration map: old,new per line
npx headless-seo-check https://example.com --only canonical,hreflang
```

Options: `--max-pages N` (default 25), `--concurrency N` (default 4), `--timeout ms` (default 15000),
`--user-agent ua` (default `headless-seo-check/<version> (+repo url)`), `--json`, `--only list`,
`--redirects file.csv`, `--fail-on error|warn|never` (default error). Exit code 1 when an issue of the
`--fail-on` level or higher exists, 2 on a usage or network failure of the start URL.

## Page set

Start URL, then `robots.txt` → `Sitemap:` lines (fallback `/sitemap.xml`), sitemap index followed one
level, URLs sampled up to `--max-pages` (first N in sitemap order, start URL always included). Same
origin only. No link crawling in v0.1.

## Checks (each issue: id, level error|warn|info, url, message, detail)

1. **redirects**: every page fetched with `redirect: "manual"`, chain followed up to 10 hops. error: loop,
   chain > 10, final status not 200; warn: more than one hop, 302/307 where a 301/308 is expected (http to
   https, trailing slash, host change), mixed http hop. With `--redirects map.csv`: each old URL must reach
   its new URL in one 301/308 hop and the new URL must return 200 (error otherwise, and a summary count).
2. **canonical**: from raw HTML `<link rel=canonical>` and the `Link:` header. error: more than one
   canonical, canonical points to a non 200 or redirecting URL, canonical on a noindex page; warn: missing,
   relative URL, points to another URL (not self) which is fine but reported as info when the target is
   indexable 200; warn when `og:url` disagrees.
3. **hreflang**: `<link rel=alternate hreflang>` in HTML, the `Link:` header, and `xhtml:link` in sitemaps.
   error: invalid language or region code, alternate returns non 200, missing return link (reciprocity:
   fetch each alternate once and check it links back), self reference missing; warn: no `x-default`,
   alternate is not its own canonical.
4. **sitemap**: error: sitemap missing or not XML, URL in sitemap returns non 200, redirects, is noindex
   or has a canonical to another URL; warn: more than 50,000 URLs or 50 MB in one file, `lastmod` invalid,
   sitemap not listed in robots.txt; info: count of URLs and sampled pages.
5. **no-js** (rendering without JavaScript, what AI crawlers see): parse the raw HTML only. error: no
   `<title>`, no `<h1>`, visible text under 50 words while the page has a known SPA root (`#__next`,
   `#root`, `#app`, `#__nuxt`, `#___gatsby`) that is empty; warn: no meta description, fewer than 3 internal
   `<a href>` links, main text under 150 words, `noindex` in meta robots or `X-Robots-Tag` (info if the
   page is not in the sitemap). Report text word count and link count per page.
6. **robots** (support): robots.txt fetched once; warn when it blocks GPTBot, ClaudeBot, PerplexityBot,
   Google-Extended or OAI-SearchBot (info level; it may be a deliberate choice), error when it disallows the
   start URL for `*` or Googlebot.

## Output

Human: one block per check with error and warning counts, then the issues grouped by URL, colors when TTY,
plus a final line `N errors, M warnings, K pages`. JSON: `{ version, startUrl, pages: [{url, status,
finalUrl, words, links}], issues: [...], summary: {errors, warnings, info} }`, stable for CI diffing.

## Build

- Node 22+, TypeScript, ESM, compiled to `dist/` with `tsc`; bin `headless-seo-check`.
- Dependencies kept tiny: an HTML parser (`node-html-parser`) and an XML parser (`fast-xml-parser`). Fetch is
  the global `fetch`. No browser, no Puppeteer.
- Polite: one origin, concurrency limit, the user agent above, respects nothing else (it is an audit tool
  run by the site owner).
- Tests: `node:test` against a local fixture HTTP server (`test/fixtures/`), one fixture site per check with
  known good and known bad pages. `npm test` runs offline.
- GitHub Action example in README (`npx headless-seo-check $URL --fail-on error`).

## Not in v0.1

JS rendering comparison with a real browser (v0.2: optional `--render` with Playwright to diff raw vs
rendered text), link crawling beyond the sitemap, structured data validation, Core Web Vitals, AEO/GEO
scoring beyond the no-js and robots checks.
