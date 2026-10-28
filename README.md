# headless-seo-check

A small command line tool that audits the technical SEO of headless and JavaScript sites (Next.js, Nuxt, Astro, Remix, single page apps). It fetches the raw HTML, the way a crawler that does not run JavaScript sees it, and checks redirects, canonicals, hreflang, the sitemap, the content that exists before any script runs, and robots.txt.

## Why

Sites built on a JavaScript framework tend to break technical SEO in the same few places:

- redirect chains and temporary redirects left over from a migration
- canonicals that point to the wrong URL, a redirect or a noindex page
- hreflang clusters where the pages do not link back to each other
- sitemaps full of redirecting, broken or noindex URLs
- pages that are an empty shell until JavaScript runs

Google renders JavaScript, but late. Many other crawlers do not render it at all, including most AI crawlers (GPTBot, ClaudeBot, PerplexityBot). If the content is not in the first HTML response, they do not see it. This tool looks at exactly that response. It needs no browser, runs in a few seconds and fits in CI.

## Quick start

Needs Node 22 or newer.

```sh
npx headless-seo-check https://example.com
npx headless-seo-check https://example.com --max-pages 50 --json > report.json
npx headless-seo-check https://new.example.com --redirects map.csv
npx headless-seo-check https://example.com --only canonical,hreflang
```

The last line of the human output is always `N errors, M warnings, K pages`.

## Which pages are checked

The start URL first, then the URLs from the sitemap, up to `--max-pages`. Sitemaps are found through the `Sitemap:` lines in robots.txt, with `/sitemap.xml` as the fallback. A sitemap index is followed one level. Only URLs on the same origin as the start URL are used. Links on pages are not crawled in this version.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--max-pages N` | 25 | Number of pages to audit, start URL included. |
| `--concurrency N` | 4 | Parallel requests. |
| `--timeout ms` | 15000 | Timeout per request. |
| `--user-agent ua` | `headless-seo-check/<version> (+repo url)` | User agent sent with every request. |
| `--json` | off | Print the report as JSON instead of text. |
| `--only list` | all checks | Comma separated list of checks to run: `redirects`, `canonical`, `hreflang`, `sitemap`, `nojs`, `robots`. |
| `--redirects file.csv` | none | Migration map, one `old,new` pair per line. A header row and `#` comments are skipped. Old and new may be paths or full URLs. |
| `--fail-on level` | `error` | `error`, `warn` or `never`. Decides the exit code. |
| `-h`, `--help` | | Show help. |
| `-v`, `--version` | | Show the version. |

Colors are used only when stdout is a terminal and `NO_COLOR` is not set.

Exit codes:

- `0`: no issue at the `--fail-on` level or higher
- `1`: at least one issue at the `--fail-on` level or higher (`warn` counts errors and warnings, `info` never fails a run)
- `2`: usage error, or the start URL could not be fetched

## Checks and issue ids

### redirects

Every page is requested without following redirects, and the chain is followed by hand for up to 10 hops.

| Id | Level | Meaning |
| --- | --- | --- |
| `redirect-fetch-failed` | error | The request failed (DNS, connection, timeout). |
| `redirect-loop` | error | The chain loops back on itself. |
| `redirect-too-long` | error | More than 10 hops. |
| `redirect-final-status` | error | The chain ends on something other than 200. |
| `redirect-multiple-hops` | warn | More than one redirect before the final URL. |
| `redirect-temporary` | warn | A 302 or 307 where a permanent redirect is expected (http to https, trailing slash, host change). |
| `redirect-mixed-http` | warn | A redirect from https to http. |
| `redirect-map-bad-row` | error | A line of the `--redirects` file is not a valid pair. |
| `redirect-map-fetch-failed` | error | The old URL of a map row could not be fetched. |
| `redirect-map-no-redirect` | error | The old URL does not redirect. |
| `redirect-map-wrong-status` | error | The first hop is not a 301 or 308. |
| `redirect-map-target-status` | error | The new URL does not return 200. |
| `redirect-map-unreadable` | error | The `--redirects` file cannot be read. |
| `redirect-map-summary` | info | Rows checked, correct and with problems. |

With `--redirects`, each old URL must reach its new URL in one 301 or 308 hop. Rows that do not are reported with the other `redirect-map-*` ids.

### canonical

Read from the raw HTML and the `Link:` header.

| Id | Level | Meaning |
| --- | --- | --- |
| `canonical-missing` | warn | No canonical at all. |
| `canonical-multiple` | error | More than one canonical, or canonicals that disagree. |
| `canonical-invalid` | error | The value is not a usable URL. |
| `canonical-relative` | warn | The canonical is a relative URL. |
| `canonical-noindex` | error | The page has a canonical and is also noindex. |
| `canonical-og-mismatch` | warn | `og:url` differs from the canonical. |
| `canonical-target-status` | error | The canonical target does not return 200 (error or redirect). |
| `canonical-target-noindex` | error | The canonical target is noindex. |
| `canonical-other` | info | The canonical points to another URL that is indexable. Often intended. |

A canonical that points to the page itself raises nothing.

### hreflang

Read from `<link rel="alternate" hreflang>`, the `Link:` header and `xhtml:link` entries in sitemaps. Each alternate is fetched once.

| Id | Level | Meaning |
| --- | --- | --- |
| `hreflang-invalid-code` | error | The language or region code is not valid. |
| `hreflang-no-self` | error | The page does not list itself. |
| `hreflang-alternate-status` | error | An alternate does not return 200. |
| `hreflang-missing-return` | error | An alternate does not link back to the page. |
| `hreflang-no-x-default` | warn | No `x-default` alternate. |
| `hreflang-alternate-not-canonical` | warn | An alternate has a different canonical. |

### sitemap

| Id | Level | Meaning |
| --- | --- | --- |
| `sitemap-missing` | error | The sitemap cannot be fetched. |
| `sitemap-not-xml` | error | The file is not valid sitemap XML. |
| `sitemap-url-redirect` | error | A listed URL redirects. |
| `sitemap-url-status` | error | A listed URL does not return 200. |
| `sitemap-url-noindex` | error | A listed URL is noindex. |
| `sitemap-url-canonical` | error | A listed URL has a canonical pointing elsewhere. |
| `sitemap-too-many-urls` | warn | More than 50,000 URLs in one file. |
| `sitemap-too-large` | warn | More than 50 MB uncompressed in one file. |
| `sitemap-bad-lastmod` | warn | Invalid `lastmod` values. |
| `sitemap-not-in-robots` | warn | The sitemap is not listed in robots.txt. |
| `sitemap-summary` | info | URLs found and pages sampled. |

### nojs

Looks at the raw HTML only. Non-HTML URLs in a sitemap (JSON, images) are skipped. Word and link counts per page are in the JSON `pages` list.

| Id | Level | Meaning |
| --- | --- | --- |
| `nojs-no-title` | error | No `<title>`. |
| `nojs-no-h1` | error | No `<h1>`. |
| `nojs-empty-spa` | error | Under 50 words and an empty SPA root (`#__next`, `#root`, `#app`, `#__nuxt`, `#___gatsby`). |
| `nojs-no-description` | warn | No meta description. |
| `nojs-few-links` | warn | Fewer than 3 internal links. |
| `nojs-thin-content` | warn | Main text under 150 words. |
| `nojs-noindex` | warn | The page is noindex (meta robots or `X-Robots-Tag`) and is in the sitemap. |
| `nojs-noindex` | info | The same, but the page is not in the sitemap. |

### robots

robots.txt is fetched once.

| Id | Level | Meaning |
| --- | --- | --- |
| `robots-start-blocked` | error | robots.txt disallows the start URL for `*` or Googlebot. |
| `robots-ai-bot-blocked` | info | GPTBot, ClaudeBot, PerplexityBot, Google-Extended or OAI-SearchBot is blocked. This can be a deliberate choice. |

## JSON output

```json
{
  "version": "0.1.0",
  "startUrl": "https://example.com/",
  "pages": [
    { "url": "https://example.com/", "status": 200, "finalUrl": "https://example.com/", "words": 412, "links": 37 }
  ],
  "issues": [
    {
      "check": "canonical",
      "id": "canonical-missing",
      "level": "warn",
      "url": "https://example.com/",
      "message": "No canonical link in the HTML or the Link header"
    }
  ],
  "summary": { "errors": 0, "warnings": 1, "info": 0 }
}
```

Keys are always in this order and issues are sorted by check, url and id, so two runs against an unchanged site produce identical files. `detail` is an optional extra object on an issue.

## Use it as a library

```ts
import { audit } from "headless-seo-check";

const report = await audit({ startUrl: "https://example.com", maxPages: 50 });
console.log(report.summary);
```

`audit` takes the same settings as the CLI (`maxPages`, `concurrency`, `timeout`, `userAgent`, `only`, `redirectsFile`) and returns the report described above.

## GitHub Actions

```yaml
name: seo
on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

jobs:
  seo-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx headless-seo-check https://example.com --max-pages 50 --fail-on error
```

Add `--json > report.json` and upload the file as an artifact if you want to diff runs.

## Local development

```sh
git clone https://github.com/borntojesus/KT-HEADLESS-SEO-CHECK
cd KT-HEADLESS-SEO-CHECK
npm install
npm test        # builds, then runs the tests against local fixture servers, no network needed
node dist/cli.js https://example.com
```

## Roadmap

v0.2:

- `--render`: fetch the page with Playwright as well and diff the raw text against the rendered text
- link crawling beyond the sitemap
- structured data checks

Not planned: Core Web Vitals, general content scoring.

## License

MIT
