import { test } from "node:test";
import assert from "node:assert/strict";
import { Fetcher } from "../dist/fetch.js";
import { buildContext } from "../dist/pages.js";
import { robots, parseRobots, rulesFor, isAllowed } from "../dist/checks/robots.js";
import { startServer, makeOptions } from "./helpers/fixture-server-b.js";

async function run(robotsTxt, start = "/") {
  const srv = await startServer(robotsTxt === null ? {} : { "/robots.txt": robotsTxt });
  try {
    const ctx = await buildContext(makeOptions(srv.url + start), new Fetcher({ timeout: 5000, userAgent: "test", concurrency: 4 }));
    return await robots(ctx);
  } finally {
    await srv.close();
  }
}

test("matcher: longest match wins, Allow wins ties, wildcards and $", () => {
  const g = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nAllow: /tie\nDisallow: /tie\n");
  const r = rulesFor(g, "*");
  assert.equal(isAllowed(r, "/private/x"), false);
  assert.equal(isAllowed(r, "/private/open/x"), true);
  assert.equal(isAllowed(r, "/a/b.pdf"), false);
  assert.equal(isAllowed(r, "/a/b.pdf?x=1"), true);
  assert.equal(isAllowed(r, "/tie"), true);
  assert.equal(isAllowed(r, "/other"), true);
});

test("matcher: grouped agents, empty Disallow, comments, agent names case-insensitive", () => {
  const g = parseRobots("# hi\nUser-agent: GPTBot\nUser-agent: ClaudeBot # both\nDisallow: /\n\nUser-agent: *\nDisallow:\n");
  assert.equal(isAllowed(rulesFor(g, "gptbot"), "/"), false);
  assert.equal(isAllowed(rulesFor(g, "ClaudeBot"), "/"), false);
  assert.equal(isAllowed(rulesFor(g, "*"), "/"), true);
  assert.equal(rulesFor(g, "PerplexityBot"), null);
});

test("clean robots.txt gives no issues", async () => {
  assert.deepEqual(await run("User-agent: *\nDisallow: /admin\n"), []);
});

test("missing robots.txt gives no issues", async () => {
  assert.deepEqual(await run(null), []);
});

test("AI bots blocked are reported as info, one per bot", async () => {
  const txt = [
    "User-agent: GPTBot", "Disallow: /", "",
    "User-agent: ClaudeBot", "User-agent: PerplexityBot", "Disallow: /", "",
    "User-agent: Google-Extended", "Disallow: /", "",
    "User-agent: OAI-SearchBot", "Disallow: /", "",
    "User-agent: *", "Allow: /",
  ].join("\n");
  const issues = await run(txt);
  assert.equal(issues.length, 5);
  assert.ok(issues.every((i) => i.id === "robots-ai-bot-blocked" && i.level === "info"));
  assert.deepEqual(issues.map((i) => i.detail.bot).sort(), ["ClaudeBot", "GPTBot", "Google-Extended", "OAI-SearchBot", "PerplexityBot"]);
});

test("an AI bot with only a partial disallow is not reported", async () => {
  assert.deepEqual(await run("User-agent: GPTBot\nDisallow: /private\n"), []);
});

test("start URL disallowed for * is an error", async () => {
  const issues = await run("User-agent: *\nDisallow: /\n");
  assert.deepEqual(issues.map((i) => [i.id, i.level]), [["robots-start-blocked", "error"]]);
});

test("start URL disallowed only for Googlebot is an error", async () => {
  const issues = await run("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /docs\n", "/docs/intro");
  assert.deepEqual(issues.map((i) => [i.id, i.level, i.detail.agent]), [["robots-start-blocked", "error", "Googlebot"]]);
});

test("Allow can reopen the start URL", async () => {
  assert.deepEqual(await run("User-agent: *\nDisallow: /\nAllow: /$\n"), []);
});
