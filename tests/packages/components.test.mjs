// Node tests for the Components package: the icon helpers, the section
// catalogue, and the app definition itself loaded through a scratch site
// (package files beside a symlinked template/kit) so the real imports resolve.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageDir = path.join(root, "registry", "apps", "components");
const appDir = path.join(packageDir, "apps", "components");

const { filterIcons, paginate } = await import(pathToFileURL(path.join(appDir, "icons.js")));
const sections = await import(pathToFileURL(path.join(appDir, "sections.js")));
const { selectorWindowBody } = await import(pathToFileURL(path.join(root, "template", "kit", "selector.js")));
const { normalizeApp } = await import(pathToFileURL(path.join(root, "template", "kit", "apps.js")));

describe("filterIcons", () => {
  const names = ["notepad.ico", "notepad_file.ico", "Roland_GS.ico", "msg_warning.ico"];

  test("keeps everything for an empty or blank query and returns a copy", () => {
    assert.deepEqual(filterIcons(names, ""), names);
    assert.deepEqual(filterIcons(names, "   "), names);
    assert.deepEqual(filterIcons(names, undefined), names);
    assert.notEqual(filterIcons(names, ""), names);
  });

  test("matches case-insensitively and keeps the original order", () => {
    assert.deepEqual(filterIcons(names, "NOTEPAD"), ["notepad.ico", "notepad_file.ico"]);
    assert.deepEqual(filterIcons(names, "roland"), ["Roland_GS.ico"]);
  });

  test("requires every word of a multi-word query", () => {
    assert.deepEqual(filterIcons(names, "notepad file"), ["notepad_file.ico"]);
    assert.deepEqual(filterIcons(names, "notepad roland"), []);
  });
});

describe("paginate", () => {
  const list = ["a", "b", "c", "d", "e"];

  test("slices a middle page", () => {
    assert.deepEqual(paginate(list, 1, 2), { items: ["c", "d"], page: 1, pageCount: 3, total: 5, start: 2, end: 4 });
  });

  test("clamps the page index into range", () => {
    assert.deepEqual(paginate(list, 9, 2).items, ["e"]);
    assert.equal(paginate(list, 9, 2).page, 2);
    assert.deepEqual(paginate(list, -3, 2).items, ["a", "b"]);
    assert.equal(paginate(list, Number.NaN, 2).page, 0);
  });

  test("handles an empty list and a bad size", () => {
    assert.deepEqual(paginate([], 0, 10), { items: [], page: 0, pageCount: 1, total: 0, start: 0, end: 0 });
    assert.equal(paginate(list, 0, 0).items.length, 1);
    assert.equal(paginate(list, 0, 2.9).items.length, 2);
  });
});

describe("sections catalogue", () => {
  test("lists every section id once with a title, icon and html", () => {
    assert.equal(new Set(sections.SECTION_IDS).size, sections.SECTION_IDS.length);
    assert.deepEqual(sections.SECTION_IDS, ["buttons", "panels", "carousels", "alerts", "windows", "icons", "spacing"]);
    for (const section of sections.SECTIONS) {
      assert.ok(section.title && section.icon.startsWith("assets/app-icons/ico/"), section.id);
      assert.ok(section.html.includes("code-sample"), `${section.id} has a code sample`);
    }
  });

  test("renders a selector window body that contains every section", () => {
    const body = selectorWindowBody(sections.SECTIONS, { listLabel: "Components" });
    for (const id of sections.SECTION_IDS) {
      assert.ok(body.includes(`data-view="${id}"`), `tab for ${id}`);
      assert.ok(body.includes(`class="viewer-content${id === "buttons" ? "" : " is-hidden"}" data-view="${id}"`), `panel for ${id}`);
    }
  });

  test("escapes every code sample", () => {
    const body = selectorWindowBody(sections.SECTIONS);
    const samples = [...body.matchAll(/<pre class="code-sample"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)];
    assert.ok(samples.length >= 20, `found ${samples.length} samples`);
    for (const [, code] of samples) {
      assert.ok(!/<|>/.test(code), "no raw angle brackets inside a sample");
      assert.ok(!/^\s*$/.test(code), "sample is not blank");
    }
  });

  test("html demos show exactly the markup they render", () => {
    const body = selectorWindowBody(sections.SECTIONS);
    const unescape = (text) =>
      text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    const demos = [...body.matchAll(/<div class="demo-stage">([\s\S]*?)<\/div>\s*<pre class="code-sample" data-language="html"[^>]*><code>([\s\S]*?)<\/code>/g)];
    assert.ok(demos.length >= 8, `found ${demos.length} html demos`);
    for (const [, stage, code] of demos) assert.equal(stage, unescape(code));
  });

  test("carousel snippets mention the variant, the aspect override and the items", () => {
    for (const demo of sections.CAROUSEL_DEMOS) {
      const snippet = sections.carouselSnippet(demo);
      assert.ok(snippet.includes(`variant: "${demo.variant}"`));
      assert.equal(snippet.includes("--gallery-aspect"), Boolean(demo.aspect));
      for (const item of demo.items) assert.ok(snippet.includes(typeof item === "string" ? item : item.src));
    }
  });
});

describe("manifest", () => {
  test("lists every file in the package and nothing else", async () => {
    const manifest = JSON.parse(await readFile(path.join(packageDir, "manifest.json"), "utf8"));
    assert.equal(manifest.id, "components");
    assert.equal(manifest.kind, "app");
    assert.equal(manifest.title, "Components");
    const { readdir } = await import("node:fs/promises");
    const walk = async (dir, prefix = "") => {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...(await walk(path.join(dir, entry.name), rel)));
        else files.push(rel);
      }
      return files;
    };
    const onDisk = (await walk(packageDir)).filter((file) => file !== "manifest.json").sort();
    assert.deepEqual([...manifest.files].sort(), onDisk);
    assert.ok(onDisk.every((file) => file.startsWith("apps/components/") || file.startsWith("assets/components/")));
  });
});

describe("app definition", () => {
  let scratch;
  let app;

  before(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "components-app-"));
    await cp(path.join(packageDir, "apps"), path.join(scratch, "apps"), { recursive: true });
    await symlink(path.join(root, "template", "kit"), path.join(scratch, "kit"), "dir");
    const module = await import(pathToFileURL(path.join(scratch, "apps", "components", "index.js")));
    app = normalizeApp(module.default);
  });

  after(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  test("is a resizable selector window with its stylesheet", () => {
    assert.equal(app.id, "components");
    assert.equal(app.title, "Components");
    assert.ok(app.window.resizable);
    assert.ok(app.window.className.split(" ").includes("selector-window"));
    assert.deepEqual([...app.window.controls], ["minimize", "maximize", "close"]);
    assert.deepEqual([...app.styles], ["apps/components/components.css"]);
    assert.equal(typeof app.mount, "function");
  });

  test("declares the extra window the Windows section opens", () => {
    assert.equal(app.windows.length, 1);
    const extra = app.windows[0];
    assert.equal(extra.id, sections.EXTRA_WINDOW_ID);
    assert.ok(extra.window.center && extra.window.dialog);
    assert.equal(extra.window.width, 320);
    assert.ok(extra.render().includes("data-close-extra"));
    assert.equal(typeof extra.mount, "function");
  });

  test("renders every section and the button that opens the extra window", () => {
    const body = app.render();
    for (const id of sections.SECTION_IDS) assert.ok(body.includes(`data-view="${id}"`), id);
    assert.ok(body.includes(`data-open-window="${sections.EXTRA_WINDOW_ID}"`));
  });
});
