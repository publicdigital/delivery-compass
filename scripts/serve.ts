/**
 * Minimal static file server for local preview.
 *
 * The deployed site is static files on Netlify, so local development should serve
 * them the same way rather than through an application server — otherwise local and
 * production diverge in exactly the place that is hardest to debug.
 *
 * Two things deliberately do not work here, because they are Netlify features and
 * faking them would hide real failures:
 *   - Netlify Forms: feedback POSTs to "/" return 405, so the UI will report that
 *     sending failed. That is correct locally.
 *   - Basic Auth: the edge function does not run, so there is no password prompt.
 *
 * Run: npm run serve
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "POST") {
    // Netlify Forms handles these in production; locally, say so rather than 404.
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("Form posts are handled by Netlify in production, not by this dev server.");
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // normalize + prefix check: without it, "/../.." would escape the repo.
  const target = resolve(join(ROOT, normalize(pathname)));
  if (!target.startsWith(resolve(ROOT))) {
    res.writeHead(403).end("forbidden");
    return;
  }

  if (!existsSync(target) || statSync(target).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(target)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Delivery Compass (static preview) on http://localhost:${PORT}`);
  console.log("Form posts and Basic Auth are Netlify features and do not run locally.");
});
