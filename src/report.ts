import { CHECKS } from "./types.js";
import type { CheckName, Issue, Report } from "./types.js";

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 } as const;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort by check, url, id (then level and message so the order is fully deterministic). */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      CHECKS.indexOf(a.check) - CHECKS.indexOf(b.check) ||
      cmp(a.url, b.url) ||
      cmp(a.id, b.id) ||
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      cmp(a.message, b.message),
  );
}

export function summarize(issues: Issue[]): Report["summary"] {
  return {
    errors: issues.filter((i) => i.level === "error").length,
    warnings: issues.filter((i) => i.level === "warn").length,
    info: issues.filter((i) => i.level === "info").length,
  };
}

/** JSON with a fixed key order, for diffing in CI. */
export function formatJson(report: Report): string {
  const ordered = {
    version: report.version,
    startUrl: report.startUrl,
    pages: report.pages.map((p) => ({
      url: p.url,
      status: p.status,
      finalUrl: p.finalUrl,
      words: p.words,
      links: p.links,
    })),
    issues: sortIssues(report.issues).map((i) => ({
      check: i.check,
      id: i.id,
      level: i.level,
      url: i.url,
      message: i.message,
      ...(i.detail !== undefined ? { detail: i.detail } : {}),
    })),
    summary: {
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      info: report.summary.info,
    },
  };
  return JSON.stringify(ordered, null, 2);
}

interface Paint {
  (code: string, s: string): string;
}

export function formatHuman(report: Report, color: boolean, checks: readonly CheckName[] = CHECKS): string {
  const paint: Paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const levelPaint = { error: "31", warn: "33", info: "36" } as const;
  const lines: string[] = [];
  lines.push(paint("1", `headless-seo-check ${report.version}`) + ` ${report.startUrl}`);

  for (const check of CHECKS.filter((c) => checks.includes(c))) {
    const mine = report.issues.filter((i) => i.check === check);
    const e = mine.filter((i) => i.level === "error").length;
    const w = mine.filter((i) => i.level === "warn").length;
    const n = mine.filter((i) => i.level === "info").length;
    lines.push("");
    lines.push(
      paint("1", check) + `  ${e} error${e === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}, ${n} info`,
    );
    const byUrl = new Map<string, Issue[]>();
    for (const i of mine) byUrl.set(i.url, [...(byUrl.get(i.url) ?? []), i]);
    for (const [url, list] of byUrl) {
      lines.push("  " + paint("4", url));
      for (const i of list) {
        lines.push(`    ${paint(levelPaint[i.level], i.level.padEnd(5))} ${paint("2", i.id)}  ${i.message}`);
      }
    }
  }

  lines.push("");
  const s = report.summary;
  const summary = `${s.errors} errors, ${s.warnings} warnings, ${report.pages.length} pages`;
  lines.push(s.errors > 0 ? paint("31", summary) : s.warnings > 0 ? paint("33", summary) : paint("32", summary));
  return lines.join("\n") + "\n";
}
