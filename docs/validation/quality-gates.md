# Quality Gates

- Purpose: Repeatable checks that keep the template, registry, CLI and showcase consistent and rendered correctly.
- Scope: Authored JavaScript, package manifests, generated `showcase/`, Playwright UI checks, release steps.
- Last verified: 2026-10-18

## Commands

```bash
npm run check                       # syntax:check + showcase:check + node tests
npm run test:ui                     # Playwright, serves the repo root on UI_TEST_PORT (default 4390)
UI_TEST_PORT=4391 npm run test:ui   # second checkout or worktree
```

`npm test` runs `tests/*.test.mjs`; package logic tests live in
`tests/packages/*.test.mjs` and run with `node --test tests/packages/*.test.mjs`.

## What each gate protects

| Gate | Protects |
| --- | --- |
| `scripts/syntax-check.mjs` | every `.js`/`.mjs` under bin, cli, registry, scripts, template, tests parses |
| `tests/template.test.mjs` | `apps/installed.js` matches the app folders, icons and styles exist, stylesheets resolve `../assets/…`, the icon manifest matches the folder, kit modules carry no site-specific globals |
| `tests/registry.test.mjs` | each package manifest is valid, lists exactly its files, keeps files under `apps/<id>/`, `assets/<id>/` or `proxy/`, and its app id matches |
| `tests/cli.test.mjs` | init, add (local and remote registry), remove, sync, list, serve |
| `scripts/build-showcase.mjs --check` | `showcase/` equals a fresh build of template + registry + `showcase-src/` |
| `tests/ui/core.spec.mjs` | boot without console errors at 375×812, 768×1024, 1280×800, 1440×900; every template window reachable; drag clamping, resize, maximize; selector tabs and carousels; calendar; Display Properties persistence; deep links; Start button; surfaced boot errors |
| `tests/ui/<package>.spec.mjs` | each registry package opens at the four viewports and survives one real interaction |

## Rendered review

Automated checks do not replace looking. For UI changes, serve a site
(`node bin/win98-site-kit.mjs serve showcase --port 4310`) and inspect the
affected windows with `playwright-cli` at the four viewports, reading the
console after each state. Keep screenshots in `.playwright-cli/<session>/`
(ignored). Check title bars stay reachable, nothing overflows the window
body, images load, and the dock button shows the pressed state.

## Release

1. `npm run showcase:build`, then `npm run check` and `npm run test:ui` must pass.
2. Bump `version` in `package.json`; packages carry their own `version` in `manifest.json`.
3. Publishing to GitHub Pages: serve the repository root and link to `/showcase/`; the raw registry URL in `cli/registry.js` must point at the default branch.
