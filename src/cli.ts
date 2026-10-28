#!/usr/bin/env node
import { parseArgs } from "node:util";
import { audit } from "./index.js";
import { formatHuman, formatJson } from "./report.js";
import { CHECKS } from "./types.js";
import type { CheckName } from "./types.js";
import { DEFAULT_USER_AGENT, VERSION } from "./version.js";

const HELP = `headless-seo-check ${VERSION}
Technical SEO checks for headless and JavaScript sites.

Usage:
  headless-seo-check <url> [options]

Options:
  --max-pages N        pages to audit, start URL included (default 25)
  --concurrency N      parallel requests (default 4)
  --timeout ms         per request timeout (default 15000)
  --user-agent ua      user agent string (default ${DEFAULT_USER_AGENT})
  --json               print the report as JSON
  --only list          comma separated checks: ${CHECKS.join(",")}
  --redirects file.csv migration map, one "old,new" pair per line
  --fail-on level      error | warn | never (default error)
  -h, --help           show this help
  -v, --version        show the version

Exit codes: 0 ok, 1 issues at the --fail-on level or higher, 2 usage error or start URL unreachable.
`;

class UsageError extends Error {}

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} needs a positive integer, got "${raw}"`);
  return n;
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "max-pages": { type: "string" },
        concurrency: { type: "string" },
        timeout: { type: "string" },
        "user-agent": { type: "string" },
        json: { type: "boolean" },
        only: { type: "string" },
        redirects: { type: "string" },
        "fail-on": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  try {
    if (positionals.length !== 1) throw new UsageError("Give exactly one start URL.");
    let startUrl: string;
    try {
      const u = new URL(positionals[0] as string);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      startUrl = u.toString();
    } catch {
      throw new UsageError(`"${positionals[0]}" is not an http(s) URL.`);
    }
    const failOn = values["fail-on"] ?? "error";
    if (failOn !== "error" && failOn !== "warn" && failOn !== "never") {
      throw new UsageError(`--fail-on must be error, warn or never, got "${failOn}"`);
    }
    let only: CheckName[] = [];
    if (values.only !== undefined) {
      const names = values.only.split(",").map((s) => s.trim()).filter(Boolean);
      const bad = names.filter((n) => !CHECKS.includes(n as CheckName));
      if (bad.length > 0 || names.length === 0) {
        throw new UsageError(`Unknown check "${bad.join(", ") || values.only}". Valid: ${CHECKS.join(", ")}`);
      }
      only = names as CheckName[];
    }

    const report = await audit({
      startUrl,
      maxPages: positiveInt("max-pages", values["max-pages"], 25),
      concurrency: positiveInt("concurrency", values.concurrency, 4),
      timeout: positiveInt("timeout", values.timeout, 15000),
      userAgent: values["user-agent"] ?? DEFAULT_USER_AGENT,
      only,
      redirectsFile: values.redirects,
    });

    const start = report.pages[0];
    if (!start || start.status === 0) {
      const why = report.issues.find((i) => i.id === "redirect-fetch-failed" && i.url === start?.url);
      process.stderr.write(`Cannot reach ${startUrl}${why ? `: ${why.message}` : ""}\n`);
      return 2;
    }

    if (values.json) {
      process.stdout.write(formatJson(report) + "\n");
    } else {
      const color = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];
      process.stdout.write(formatHuman(report, color, only.length > 0 ? only : CHECKS));
    }

    if (failOn === "never") return 0;
    if (report.summary.errors > 0) return 1;
    if (failOn === "warn" && report.summary.warnings > 0) return 1;
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\n${HELP}`);
      return 2;
    }
    process.stderr.write(`Unexpected error: ${(err as Error).stack ?? err}\n`);
    return 2;
  }
}

process.exitCode = await main();
