// Dependency-free Node server that runs worker.mjs locally:
//
//   CLASH_ROYALE_API_KEY=… node proxy/clash-royale/local-proxy.mjs --port 8787
//
// Optional env: PLAYER_TAG (serve one fixed tag), ALLOWED_ORIGINS (comma
// separated; defaults to any origin for local development). The key is read
// from the environment only; never put it in a file inside the site.

import http from "node:http";
import { pathToFileURL } from "node:url";
import { CACHE_TTL_SECONDS, handleRequest } from "./worker.mjs";

/** The Cache API subset worker.mjs uses, held in memory with the 5 minute TTL. */
export const createMemoryCache = (now = Date.now) => {
  const entries = new Map();
  const keyOf = (key) => (typeof key === "string" ? key : key.url);
  return {
    async match(key) {
      const entry = entries.get(keyOf(key));
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) {
        entries.delete(keyOf(key));
        return undefined;
      }
      return new Response(entry.body, { headers: entry.headers });
    },
    async put(key, response) {
      entries.set(keyOf(key), {
        body: await response.text(),
        headers: Object.fromEntries(response.headers.entries()),
        expiresAt: now() + CACHE_TTL_SECONDS * 1000,
      });
    },
  };
};

export const parsePort = (argv) => {
  const index = argv.indexOf("--port");
  const inline = argv.find((arg) => arg.startsWith("--port="));
  const raw = index >= 0 ? argv[index + 1] : inline ? inline.slice("--port=".length) : "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be an integer between 0 and 65535, got "${raw}"`);
  }
  return port;
};

const toWebRequest = (nodeRequest, host) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`http://${host}${nodeRequest.url}`, { method: nodeRequest.method, headers });
};

/**
 * Starts the proxy; resolves with `{ port, url, close }`. `env` defaults to
 * process.env; `fetchImpl` and `now` exist so tests never reach the network.
 */
export const startLocalProxy = async ({
  port = 8787,
  host = "127.0.0.1",
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) => {
  const workerEnv = {
    CLASH_ROYALE_API_KEY: env.CLASH_ROYALE_API_KEY ?? "",
    PLAYER_TAG: env.PLAYER_TAG ?? "",
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? "*",
  };
  const cache = createMemoryCache(now);
  const server = http.createServer(async (nodeRequest, nodeResponse) => {
    const request = toWebRequest(nodeRequest, nodeRequest.headers.host ?? `${host}:${port}`);
    const response = await handleRequest(request, workerEnv, null, { cache, fetchImpl, now });
    nodeResponse.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    nodeResponse.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (!process.env.CLASH_ROYALE_API_KEY) {
    console.error("CLASH_ROYALE_API_KEY is not set; every request will answer 503 until it is.");
  }
  const proxy = await startLocalProxy({ port: parsePort(process.argv.slice(2)) });
  console.log(`Clash Royale proxy listening at ${proxy.url}/clash-royale`);
  console.log(`Put "${proxy.url}" into apps/clash-royale/config.js as proxyBaseUrl.`);
}
