import http from "node:http";

/**
 * Tiny fixture server. routes: { "/path": string | { status, headers, body } | (req) => same }.
 * Unknown paths return 404. Returns { url, close, hits }.
 */
export async function startServer(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    let route = routes[req.url];
    if (typeof route === "function") route = route(req);
    if (route === undefined) route = { status: 404, body: "not found" };
    if (typeof route === "string") route = { status: 200, body: route };
    res.writeHead(route.status ?? 200, route.headers ?? {});
    res.end(route.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    hits,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

export function makeOptions(startUrl, extra = {}) {
  return { startUrl, maxPages: 50, concurrency: 4, timeout: 5000, userAgent: "test", only: [], ...extra };
}
