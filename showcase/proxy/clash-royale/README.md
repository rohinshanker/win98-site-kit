# Clash Royale proxy

Optional. The Clash Royale Stats window reads player data from the official
Clash Royale API, which needs a secret developer key. This folder is the one
server-side piece in the kit: a tiny Cloudflare Worker that holds the key,
calls the API for one player and returns only the fields the window shows.
Nothing else in the site depends on it; skip it and the window shows setup
steps instead. A live version of the window, backed by this proxy, runs on
[rohin.shanker.me](https://rohin.shanker.me/).

Files:

- `worker.mjs` — the Worker. `GET /clash-royale?tag=XXXX` (or the fixed
  `PLAYER_TAG`) returns `{ ok, player, battles, fetchedAt, cacheTtlSeconds }`,
  caches each snapshot for five minutes and answers CORS for `ALLOWED_ORIGINS`.
- `local-proxy.mjs` — runs the same handler under Node for development.
- `wrangler.jsonc.example` — the deploy config to copy.

## Deploy (about ten minutes, once)

1. Create a key at [developer.clashroyale.com](https://developer.clashroyale.com/).
   The official API only accepts calls from allowlisted IPs, so the Worker goes
   through [RoyaleAPI's proxy](https://docs.royaleapi.com/proxy.html): when the
   portal asks for allowed IP addresses, enter the proxy IP from that page
   (`45.79.218.79` at the time of writing).
2. Install Wrangler and sign in: `npm install --save-dev wrangler`, then
   `npx wrangler login`.
3. `cp wrangler.jsonc.example wrangler.jsonc` and edit `vars`:
   - `PLAYER_TAG`: your tag (Profile > the code under your name, `#` optional).
     The proxy then serves only that player, so nobody else can spend your
     API quota through it.
   - `ALLOWED_ORIGINS`: the origins your site is served from, comma separated
     (for example `https://you.github.io,http://127.0.0.1:4173`).
4. Store the key as a secret (it prompts; the value never touches a file):

   ```sh
   npx wrangler secret put CLASH_ROYALE_API_KEY
   ```

5. `npx wrangler deploy`. Wrangler prints the Worker URL, for example
   `https://clash-royale-proxy.<you>.workers.dev`.
6. Open `apps/clash-royale/config.js` in your site: set `playerTag` to the same
   tag and `proxyBaseUrl` to that URL. Reload the desktop and open the window.

Check it from a terminal: `curl "https://<worker-url>/clash-royale"` returns
the JSON snapshot; `{"ok":false,...,"code":"CLASH_ROYALE_NOT_CONFIGURED"}`
means the secret is missing, `CLASH_ROYALE_UPSTREAM_AUTH` means the key is
wrong or the proxy IP is not allowlisted. Rotate the key with the same
`secret put` command.

## Local development

```sh
CLASH_ROYALE_API_KEY=your-key PLAYER_TAG=#2PP node proxy/clash-royale/local-proxy.mjs --port 8787
```

Then set `proxyBaseUrl` to `http://127.0.0.1:8787` (or, without editing
config.js, run `localStorage.setItem("win98SiteKit.clash-royale.proxyBaseUrl",
"http://127.0.0.1:8787")` in the browser console and reload). The script reads
the key from the environment only and allows any origin unless
`ALLOWED_ORIGINS` is set.

## Request contract

- `GET /clash-royale` with optional `?tag=XXXX`. With `PLAYER_TAG` set the
  query must match it (403 otherwise); without it the query is required.
- Success: `200 { ok: true, player, battles, fetchedAt, cacheTtlSeconds: 300 }`.
  `player` holds tag, name, trophies, bestTrophies, wins, losses, battleCount,
  threeCrownWins, clan, arena and up to eight `currentDeck` cards; `battles`
  holds up to twenty entries with battleTime, type, gameMode, team and
  opponent participants (tag, name, crowns, trophyChange, clan, up to sixteen
  cards). Card entries keep id, name, level, elixirCost, rarity, variant
  (`evo` / `hero`) and validated `api-assets.clashroyale.com` artwork URLs.
- Errors: `{ ok: false, error, code?, retryAfterMs? }` with 400 (bad tag),
  403 (origin or tag refused), 429 (upstream rate limit, with `Retry-After`),
  502 (upstream error or invalid data), 503 (no key), 504 (timeout).
- Snapshots are cached for five minutes per Cloudflare location, so Refresh
  may return the same `fetchedAt` for a while.
