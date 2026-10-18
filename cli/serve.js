// A dependency-free static file server for local development. Serves one
// directory with correct MIME types for everything the kit ships.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".cur": "image/x-icon",
  ".ani": "application/x-navi-animation",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
};

export const contentTypeFor = (file) => MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Starts the server; resolves with `{ server, port, close }`. Port 0 picks a free port. */
export const serveDirectory = (rootDir, { port = 4173, host = "127.0.0.1" } = {}) => {
  const root = path.resolve(rootDir);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      let relative = decodeURIComponent(url.pathname);
      if (relative.endsWith("/")) relative += "index.html";
      const file = path.join(root, relative);
      if (!file.startsWith(root)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) {
        response.writeHead(404, { "content-type": "text/plain" }).end(`Not found: ${relative}`);
        return;
      }
      response.writeHead(200, {
        "content-type": contentTypeFor(file),
        "content-length": info.size,
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" }).end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://${host}:${address.port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
};
