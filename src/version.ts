import { readFileSync } from "node:fs";

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
export const REPO_URL = "https://github.com/borntojesus/KT-HEADLESS-SEO-CHECK";
export const DEFAULT_USER_AGENT = `headless-seo-check/${VERSION} (+${REPO_URL})`;
