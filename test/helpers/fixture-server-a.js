import { createServer } from "node:http";
import { Fetcher } from "../../dist/fetch.js";

/**
 * Tiny server. routes (or a function of the base URL returning routes): { "/path": { status, headers, body } | "html string" }.
 * Returns { base, close, routes }. Unknown paths answer 404.
 */
export async function startServer(routesOrFactory) {
  let routes = typeof routesOrFactory === "function" ? {} : routesOrFactory;
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (route === undefined) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("not found");
      return;
    }
    const r = typeof route === "string" ? { body: route } : route;
    res.writeHead(r.status ?? 200, { "content-type": "text/html", ...(r.headers ?? {}) });
    res.end(r.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (typeof routesOrFactory === "function") routes = routesOrFactory(base);
  return { base, close: () => new Promise((resolve) => server.close(resolve)), routes };
}

export function makeCtx(base, paths, extra = {}) {
  return {
    options: { startUrl: base + paths[0], maxPages: 50, concurrency: 4, timeout: 3000, userAgent: "test", only: [], ...(extra.options ?? {}) },
    fetcher: new Fetcher({ timeout: 3000, userAgent: "test", concurrency: 4 }),
    origin: base,
    pages: paths.map((p) => ({ url: base + p, inSitemap: true })),
    sitemaps: [],
    sitemapUrls: [],
    sitemapAlternates: extra.sitemapAlternates ?? new Map(),
    robotsTxt: "",
  };
}

export const ids = (issues) => issues.map((i) => i.id).sort();
