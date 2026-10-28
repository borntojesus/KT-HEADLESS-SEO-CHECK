import { gunzipSync } from "node:zlib";
import { normUrl, resolveUrl } from "./url.js";

export interface FetchResult {
  url: string;
  /** HTTP status, 0 when the request failed (network error, timeout, bad URL). */
  status: number;
  headers: Record<string, string>;
  /** Absolute redirect target when the response is a 3xx with a Location header. */
  location?: string;
  body: Buffer;
  error?: string;
}

export interface Hop {
  url: string;
  status: number;
  location?: string;
}

export interface Chain {
  url: string;
  /** Every response in order, the last one is the final response. */
  hops: Hop[];
  finalUrl: string;
  status: number;
  final: FetchResult;
  loop: boolean;
  tooLong: boolean;
  error?: string;
}

export interface FetcherOptions {
  timeout: number;
  userAgent: string;
  concurrency: number;
}

export const MAX_HOPS = 10;

export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

/** Concurrency limiter: at most `n` functions run at once, the rest wait in FIFO order. */
export function createLimiter(n: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

export function bodyText(res: FetchResult): string {
  let buf = res.body;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf);
    } catch {
      // not gzip after all
    }
  }
  return buf.toString("utf8");
}

export class Fetcher {
  private readonly cache = new Map<string, Promise<FetchResult>>();
  private readonly chains = new Map<string, Promise<Chain>>();
  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Number of real network requests made, used by tests to prove the cache works. */
  requests = 0;

  constructor(private readonly opts: FetcherOptions) {
    this.limit = createLimiter(Math.max(1, opts.concurrency));
  }

  /** One request with redirect: "manual". Cached per URL, so each URL is fetched once per run. */
  fetchOnce(url: string): Promise<FetchResult> {
    const key = normUrl(url);
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.limit(() => this.request(key));
      this.cache.set(key, hit);
    }
    return hit;
  }

  /** Follow redirects by hand up to MAX_HOPS, recording every hop. */
  chain(url: string): Promise<Chain> {
    const key = normUrl(url);
    let hit = this.chains.get(key);
    if (!hit) {
      hit = this.follow(key);
      this.chains.set(key, hit);
    }
    return hit;
  }

  private async follow(start: string): Promise<Chain> {
    const hops: Hop[] = [];
    const seen = new Set<string>();
    let current = start;
    for (;;) {
      const res = await this.fetchOnce(current);
      hops.push({ url: current, status: res.status, location: res.location });
      seen.add(current);
      const base = { url: start, hops, finalUrl: current, status: res.status, final: res };
      if (res.error) return { ...base, loop: false, tooLong: false, error: res.error };
      if (!isRedirect(res.status) || !res.location) {
        return { ...base, loop: false, tooLong: false };
      }
      const next = normUrl(res.location);
      if (seen.has(next)) return { ...base, loop: true, tooLong: false };
      if (hops.length > MAX_HOPS) return { ...base, loop: false, tooLong: true };
      current = next;
    }
  }

  private async request(url: string): Promise<FetchResult> {
    this.requests++;
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeout),
        headers: {
          "user-agent": this.opts.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const body = Buffer.from(await res.arrayBuffer());
      const loc = headers["location"];
      const location = loc && isRedirect(res.status) ? (resolveUrl(loc, url) ?? undefined) : undefined;
      return { url, status: res.status, headers, location, body };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      let message = e.cause?.code ?? e.cause?.message ?? e.message;
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        message = `timeout after ${this.opts.timeout} ms`;
      }
      return { url, status: 0, headers: {}, body: Buffer.alloc(0), error: message };
    }
  }
}
