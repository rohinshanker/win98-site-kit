// The template must be internally consistent: every referenced asset,
// stylesheet and app exists, installed.js matches the app folders, and the
// vendored 98.css resolves its own assets relative to styles/.

import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeConfig } from "../template/kit/config.js";
import { expandPlacement, normalizeApps } from "../template/kit/apps.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = path.join(root, "template");
const exists = (target) => stat(target).then(() => true, () => false);

const appFolders = (await readdir(path.join(template, "apps"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test("apps/installed.js lists every app folder once, in order", async () => {
  const source = await readFile(path.join(template, "apps", "installed.js"), "utf8");
  const imported = [...source.matchAll(/from "\.\/([a-z0-9-]+)\/index\.js"/g)].map((match) => match[1]);
  assert.deepEqual(imported, appFolders);
});

test("every template app is a valid definition with existing icon and styles", async () => {
  globalThis.window ??= {};
  const definitions = [];
  for (const id of appFolders) {
    definitions.push((await import(`../template/apps/${id}/index.js`)).default);
  }
  const apps = normalizeApps(definitions);
  assert.deepEqual(apps.map((app) => app.id).sort(), appFolders);
  for (const app of apps) {
    assert.ok(await exists(path.join(template, app.icon)), `${app.id} icon ${app.icon}`);
    for (const style of app.styles) assert.ok(await exists(path.join(template, style)), `${app.id} style ${style}`);
  }
});

test("site.config.js validates and only places installed apps", async () => {
  const config = normalizeConfig((await import("../template/site.config.js")).default);
  expandPlacement(config.desktop, appFolders, "desktop");
  expandPlacement(config.dock, appFolders, "dock");
  for (const choice of config.background.choices) {
    if (choice.image) assert.ok(await exists(path.join(template, choice.image)), choice.image);
  }
  if (config.background.image) assert.ok(await exists(path.join(template, config.background.image)));
  for (const photo of Object.values(config.calendar.photos)) {
    assert.ok(await exists(path.join(template, photo.image)), photo.image);
  }
});

test("index.html references files that exist", async () => {
  const html = await readFile(path.join(template, "index.html"), "utf8");
  const references = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((match) => match[1]);
  assert.ok(references.includes("kit/boot.js"));
  for (const reference of references) assert.ok(await exists(path.join(template, reference)), reference);
});

test("stylesheets resolve their asset URLs relative to styles/", async () => {
  for (const name of ["98.css", "kit.css", "cursors.css"]) {
    const css = await readFile(path.join(template, "styles", name), "utf8");
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
    for (const url of urls) {
      assert.ok(url.startsWith("../assets/"), `${name}: ${url} should start with ../assets/`);
      if (name !== "cursors.css") {
        assert.ok(await exists(path.join(template, "styles", url)), `${name}: ${url} exists`);
      }
    }
  }
});

test("the icon manifest matches the icon folder", async () => {
  const manifest = JSON.parse(await readFile(path.join(template, "assets", "app-icons", "manifest.json"), "utf8"));
  const icons = (await readdir(path.join(template, "assets", "app-icons", "ico"))).filter((n) => n.endsWith(".ico")).sort();
  assert.deepEqual(manifest, icons);
  assert.ok(icons.length >= 600);
});

test("kit modules carry no personal-website globals or backend references", async () => {
  const kitDir = path.join(template, "kit");
  for (const file of await readdir(kitDir)) {
    const source = await readFile(path.join(kitDir, file), "utf8");
    assert.doesNotMatch(source, /window\.home[A-Z]|rohinGameStats|workers\.dev|wrangler/, file);
    assert.doesNotMatch(source, /\bTODO\b|\bFIXME\b/, file);
  }
});
