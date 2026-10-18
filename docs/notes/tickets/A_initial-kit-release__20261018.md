# A_initial-kit-release__20261018 — Active

- Scope: First usable release of win98-site-kit: template, kit core, CLI, registry packages (four games, writing, creative-work, study-resources, neko, counter, clash-royale with optional proxy, components demo), showcase, docs and tests.
- Status: active
- Opened: 2026-10-18
- Updated: 2026-10-18
- Current State: Core modules, template apps, CLI (`init/add/remove/list/sync/serve`), showcase build/check and the writing/creative-work packages are in place with node tests. Game and app ports are being produced as registry packages with their own tests. Remaining: assemble the showcase with every package, run the full gate suite and Playwright at four viewports, push to the private GitHub repository, owner review.
- Verification: `npm run check` and `npm run test:ui` pass; every registry package has `tests/packages/<id>.test.mjs` and `tests/ui/<id>.spec.mjs`; showcase inspected at 375×812, 768×1024, 1280×800 and 1440×900 with a clean console.
- Cleanup: Distill the porting rules and gates into `docs/validation/` (done for package-porting.md and quality-gates.md), then resolve and delete this ticket and its index row after the owner accepts the showcase.

## Decisions

- ES modules with no build step; apps are folders exporting a definition; `apps/installed.js` is generated.
- Games and optional apps live in `registry/` and are copied into a site by the CLI (local registry when the package is installed, raw GitHub otherwise).
- No backend in the kit; the Clash Royale proxy is an optional, self-contained package file set.
- Cursor packs are not bundled; the runtime and stylesheet are a skeleton keyed to documented file names.
- Random events, Video Editor, Modeling and Admin Controls from the original site are out of scope.
