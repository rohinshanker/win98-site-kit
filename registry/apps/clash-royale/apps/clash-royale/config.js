// Clash Royale Stats settings. Edit the two values below, nothing else.
//
// playerTag     Your in-game player tag, with or without the leading "#"
//               (Profile > the code under your name, e.g. "#2PP").
// proxyBaseUrl  The URL of your deployed proxy, e.g.
//               "https://clash-royale-proxy.<you>.workers.dev". The official
//               API needs a secret key, so the browser never calls it
//               directly; proxy/clash-royale/README.md explains the one-time
//               deploy. While this stays "" the window shows setup steps
//               instead of making requests.
//
// Runtime override (handy for local testing without editing this file): set
// localStorage "win98SiteKit.clash-royale.proxyBaseUrl" and/or
// "win98SiteKit.clash-royale.playerTag" in the browser console, then reload.
// For a proxy on this machine: node proxy/clash-royale/local-proxy.mjs --port 8787
// and use "http://127.0.0.1:8787" as the URL.

export default {
  playerTag: "#2PP",
  proxyBaseUrl: "",
};
