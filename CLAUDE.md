# KT-HEADLESS-SEO-CHECK

> Open source CLI that checks technical SEO of headless sites: redirects, canonical, hreflang, sitemap, rendering without JS

- **Class:** OURS (personal, `personal/KT-KIT/`, git identity borntojesus, public repo `borntojesus/KT-HEADLESS-SEO-CHECK`, push straight to `main` on request)
- **Stack:** Node 22 + TypeScript (ESM, `tsc` to `dist/`), deps only `node-html-parser` and `fast-xml-parser`, global `fetch`, tests with `node:test`
- **Dev:** no server, no port. `node dist/cli.js <url>` after `npm run build`
- **Deploy:** npm package, see [DEPLOY.md](DEPLOY.md). Spec: [docs/SPEC.md](docs/SPEC.md)
- **Why it exists:** public proof for the "headless technical SEO" brand goal (BR-CONTENT-LAB `docs/challenge/strategy.md` §1.1a)

## Commands

```sh
npm install
npm run build    # rm -rf dist, tsc, chmod +x dist/cli.js
npm test         # build + node --test "test/*.test.js"; offline, local fixture servers only
node dist/cli.js https://example.com --max-pages 10 [--json] [--only nojs,canonical]
```

## Layout

```
src/cli.ts       arg parsing (node:util parseArgs), exit codes, start URL unreachable = 2
src/index.ts     audit(options) -> Report, re-exports types and formatters
src/report.ts    sortIssues, summarize, formatJson (fixed key order), formatHuman (ANSI only with a TTY and no NO_COLOR)
src/fetch.ts     Fetcher: redirect "manual", per-URL cache, hop-by-hop chains, concurrency limiter
src/pages.ts     buildContext (robots, sitemaps, page sample), analyzeHtml, loadPage, pageSummaries
src/checks/      one file per check, each exports a Check (ctx) => Issue[]; redirects also has checkRedirectMap
test/            one test file per check + cli.test.js (spawns dist/cli.js); helpers/fixture-server-*.js
```

## Gotchas / non-obvious

- Tests import from `dist/`, so always run `npm test` (it builds first), not `node --test` alone. Use the glob `test/*.test.js`: a bare `test/` directory argument fails on newer Node.
- Every URL is fetched once per run through `Fetcher.fetchOnce`; checks must go through the fetcher, never call `fetch` directly.
- `loadPage` skips HTML analysis for responses with a non-HTML content type (sitemaps often list JSON or images). A missing content type counts as HTML so fixtures stay simple.
- The start URL is always `pages[0]`; the CLI uses `status === 0` there to exit 2.
- Issue ids are public API (README lists them). Renaming one is a breaking change.
- README and any user-facing text: no dashes as punctuation.
- `repository` URL in package.json points at the GitHub repo that does not exist until the first manual push.
