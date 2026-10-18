# Porting a personal-website feature into a registry package

- Purpose: Turn one Home feature from the personal website into a self-contained, downloadable win98-site-kit package.
- Scope: `registry/apps/<id>/` and `registry/games/<id>/`, their tests, and the verification loop.
- Last verified: 2026-10-18

## Sources

The original site checkout is read-only reference material:
`/Users/Rohin/Desktop/coding_stuff/personal-website-worktrees/retry-feedback-biome-20261017`.
Feature scripts live in `scripts/home/features/*.js` (IIFEs that destructure
`window.home*` globals), pure rule engines in `scripts/home/games/*.js`,
window markup in `home.html` (`data-app-window="<id>"` blocks), styles in
`styles/home/`, assets in `assets/`. Never edit that checkout.

## Target shape

```
registry/<apps|games>/<id>/
  manifest.json                     id, kind, title, description, version, files[], requires[]
  apps/<id>/index.js                default export: the app definition (template/kit/apps.js)
  apps/<id>/<id>.css                styles, asset URLs relative to the CSS file (../../assets/<id>/…)
  apps/<id>/rules.js                pure logic, importable from node tests (no DOM, no window)
  assets/<id>/…                     every asset the package needs, copied from the source checkout
```

`files` lists every file in the package except `manifest.json`, and all of
them sit under `apps/<id>/`, `assets/<id>/` or (for an optional server-side
helper such as the Clash Royale proxy) `proxy/<id>/`, so `remove` can clean up.

## Conversion rules

1. `const { a, b } = window.homeX;` becomes `import { a, b } from "../../kit/index.js";`
   when the kit provides it (see `template/kit/index.js`). Rename to the kit
   names: `clampNumber` → `clamp`, `padTwoDigits` → `pad2`, `readJsonStorage(() => localStorage, key, fb)`
   → `storage.readJson(key, fb)`, `writeJsonStorage` → `storage.writeJson`, `removeStorage` → `storage.remove`,
   `setWindowOpen(id, true/false)` → `openWindow(id)` / `closeWindow(id)`,
   `registerWindowLifecycle(id, hooks)` → the app definition's `onOpen` / `onClose` / `onResize` hooks,
   `registerActiveWindowKeyHandler(id, fn)` → `registerKeyHandler(id, fn)` or the `onKeydown` hook,
   `registerViewportObserver({ onFrame })` → `onViewportResize(fn)`,
   `window.homeDom.byId(...)` → `win.querySelector(...)` on the mounted window.
2. Helpers the kit does not provide (seven-segment counters, confetti,
   fireworks, static noise, shared rule helpers such as `createBudget`,
   `assertInteger`, `GameRuleError`) are copied into the package under
   `apps/<id>/`. Packages stay self-contained; duplication across packages is accepted.
3. Delete everything tied to the backend: Game Stats hooks
   (`createGameStatsHooks`, `registerGameStatsLocalSource`, leaderboards,
   "Game Progress"), verified game sessions (`homeGameSession`, issued games,
   replay hashes), Administrator sign-in, random-event `notifyActivity` calls,
   Admin targets (`data-admin-target`), prerender activation
   (`runAfterHomeActivation` → run immediately). Keep local high scores,
   saved games and settings in localStorage under `win98SiteKit.<id>.*`.
4. The window markup from `home.html` becomes `render()` (template string,
   `.window-body` contents only). Secondary windows (rules, controls) go in
   `windows: [...]`. Title-bar buttons come from `window.controls`.
5. Keep gameplay, keyboard and touch controls, loading animations and
   responsive behaviour exactly as the original. Remove owner-specific copy.

## Verification loop

```bash
cd /Users/Rohin/Desktop/coding_stuff/win98-site-kit
node bin/win98-site-kit.mjs init tmp/<id>-site --force
node bin/win98-site-kit.mjs add <id> --dir tmp/<id>-site --registry ./registry
node bin/win98-site-kit.mjs serve tmp/<id>-site --port <PORT> &     # one port per package
export PLAYWRIGHT_MCP_OUTPUT_DIR="$PWD/.playwright-cli/kit-<id>"; mkdir -p "$PLAYWRIGHT_MCP_OUTPUT_DIR"
playwright-cli -s=kit-<id> open http://127.0.0.1:<PORT>/index.html#<id>
playwright-cli -s=kit-<id> resize 375 812      # then 768 1024, 1280 800, 1440 900
playwright-cli -s=kit-<id> screenshot --filename="$PLAYWRIGHT_MCP_OUTPUT_DIR/<id>-mobile.png"
playwright-cli -s=kit-<id> console              # must show no errors
playwright-cli -s=kit-<id> run-code "async (page) => { /* play a few moves */ }"
```

Re-run `add` with `--force` after every change to the package (the scratch
site holds copies). Inspect screenshots for overflow, clipping, unreachable
title bars and broken images. Then:

```bash
node --test tests/packages/<id>.test.mjs
UI_TEST_SITE=tmp/<id>-site npx playwright test tests/ui/<id>.spec.mjs
```

The spec uses `openSite`, `openApp`, `VIEWPORTS` and `expectWindowReachable`
from `tests/ui/helpers.mjs`; it must open the window at all four viewports,
exercise one real interaction, and end with `expectClean()`.
