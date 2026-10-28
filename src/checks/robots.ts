import type { Check } from "../context.js";
import type { Issue } from "../types.js";

export const AI_BOTS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "OAI-SearchBot"] as const;

interface Rule {
  allow: boolean;
  pattern: string;
}
export interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(txt: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | undefined;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m || !m[1]) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (cur && value !== "") cur.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Rules of every group naming `agent` exactly (case-insensitive); null when none does. */
export function rulesFor(groups: Group[], agent: string): Rule[] | null {
  const a = agent.toLowerCase();
  const hit = groups.filter((g) => g.agents.includes(a));
  if (hit.length === 0) return null;
  return hit.flatMap((g) => g.rules);
}

function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path) ? body.length : -1;
}

/** Longest matching pattern wins, Allow wins a tie, no match means allowed. */
export function isAllowed(rules: Rule[], path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules) {
    const len = matchLength(r.pattern, path);
    if (len < 0) continue;
    if (len > best || (len === best && r.allow)) {
      best = len;
      allowed = r.allow;
    }
  }
  return allowed;
}

export const robots: Check = async (ctx) => {
  const issues: Issue[] = [];
  if (!ctx.robotsTxt.trim()) return issues;
  const groups = parseRobots(ctx.robotsTxt);
  const robotsUrl = ctx.origin + "/robots.txt";

  const start = new URL(ctx.options.startUrl);
  const path = start.pathname + start.search;
  const starRules = rulesFor(groups, "*") ?? [];
  for (const agent of ["*", "Googlebot"]) {
    const own = agent === "*" ? starRules : rulesFor(groups, agent);
    if (agent !== "*" && !own && !isAllowed(starRules, path)) continue; // already reported for *
    const rules = own ?? starRules;
    if (!isAllowed(rules, path)) {
      issues.push({
        check: "robots",
        id: "robots-start-blocked",
        level: "error",
        url: ctx.options.startUrl,
        message: `robots.txt disallows the start URL for ${agent === "*" ? "all crawlers (*)" : "Googlebot"}.`,
        detail: { agent, path },
      });
    }
  }

  for (const bot of AI_BOTS) {
    const rules = rulesFor(groups, bot);
    if (rules && !isAllowed(rules, "/")) {
      issues.push({
        check: "robots",
        id: "robots-ai-bot-blocked",
        level: "info",
        url: robotsUrl,
        message: `robots.txt blocks ${bot}. This may be a deliberate choice.`,
        detail: { bot },
      });
    }
  }
  return issues;
};
