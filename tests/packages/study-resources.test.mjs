// Node tests for the Study Resources package: the shipped resource tree and
// the pure explorer module (indexing, text, counts, sizes, navigation).

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as explorer from "../../registry/apps/study-resources/apps/study-resources/explorer.js";
import resources, { ROOT_NAME } from "../../registry/apps/study-resources/apps/study-resources/resources.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/apps/study-resources"
);

const sampleTree = () => [
  {
    name: "Course Notes",
    type: "folder",
    children: [{ name: "Notes.pdf", type: "pdf", href: "assets/x/notes.pdf", size: 1536, pages: 2 }],
  },
  {
    name: "Cheat Sheets",
    type: "folder",
    children: [
      { name: "Sheet.pdf", type: "pdf", href: "assets/x/sheet.pdf", size: 2048 },
      { name: "Site", type: "link", href: "https://example.com/" },
      { name: "Empty", type: "folder", children: [] },
    ],
  },
];

const setup = () => {
  const index = explorer.createIndex(sampleTree(), "Root");
  return { index, state: explorer.createState(index) };
};

test("manifest lists every package file and each exists", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "study-resources");
  assert.equal(manifest.kind, "app");
  assert.ok(manifest.files.includes("apps/study-resources/index.js"));
  for (const file of manifest.files) assert.ok((await stat(path.join(packageDir, file))).isFile(), file);
});

test("shipped resources validate and reference shipped PDFs with their real sizes", async () => {
  const index = explorer.createIndex(resources, ROOT_NAME);
  const pdfs = [...index.entries.values()].filter((entry) => explorer.isPdf(entry.node));
  assert.equal(pdfs.length, 2);
  for (const { node } of pdfs) {
    const file = await stat(path.join(packageDir, node.href));
    assert.equal(node.size, file.size, node.href);
  }
  const links = [...index.entries.values()].filter((entry) => explorer.isLink(entry.node));
  assert.equal(links.length, 1);
  assert.equal(index.root.children.length, 2);
});

test("validateResources names the offending entry", () => {
  assert.throws(() => explorer.validateResources({}), /children must be an array/);
  assert.throws(() => explorer.validateResources([null]), /#1: must be an object/);
  assert.throws(() => explorer.validateResources([{ type: "pdf", href: "a" }]), /name must be a non-empty string/);
  assert.throws(() => explorer.validateResources([{ name: "X", type: "doc" }]), /X: type must be/);
  assert.throws(() => explorer.validateResources([{ name: "X", type: "pdf" }]), /href must be/);
  assert.throws(
    () => explorer.validateResources([{ name: "X", type: "pdf", href: "a", size: -1 }]),
    /size must be/
  );
  assert.throws(
    () => explorer.validateResources([{ name: "X", type: "pdf", href: "a", pages: 0 }]),
    /pages must be/
  );
  assert.throws(
    () => explorer.validateResources([{ name: "F", type: "folder", children: [{ name: "G", type: "x" }] }]),
    /F > G: type must be/
  );
  assert.deepEqual(explorer.validateResources([]), []);
});

test("createIndex assigns path slugs as ids and keeps them unique", () => {
  const { index } = setup();
  assert.equal(index.root.id, explorer.ROOT_ID);
  assert.deepEqual(index.root.children, ["course-notes", "cheat-sheets"]);
  assert.deepEqual(explorer.getEntry(index, "cheat-sheets").children, [
    "cheat-sheets-sheet-pdf",
    "cheat-sheets-site",
    "cheat-sheets-empty",
  ]);
  assert.deepEqual(explorer.getEntry(index, "course-notes-notes-pdf").path, ["Root", "Course Notes", "Notes.pdf"]);
  assert.equal(explorer.getEntry(index, "course-notes-notes-pdf").parentId, "course-notes");
  assert.equal(explorer.getEntry(index, "missing"), null);
  assert.equal(explorer.parentEntry(index, index.root), null);

  const dupes = explorer.createIndex([
    { name: "A", type: "folder", children: [] },
    { name: "a!", type: "folder", children: [] },
    { name: "!!", type: "folder", children: [] },
  ]);
  assert.deepEqual(dupes.root.children, ["a", "a-2", "item"]);
});

test("text helpers format path, counts, sizes and types", () => {
  const { index } = setup();
  assert.equal(explorer.pathText(explorer.getEntry(index, "cheat-sheets-site")), "Root\\Cheat Sheets\\Site");
  assert.equal(explorer.pathText(null), "");
  assert.equal(explorer.objectCountText(0), "0 objects");
  assert.equal(explorer.objectCountText(1), "1 object");
  assert.equal(explorer.subitemText(index.root.node), "2 items");
  assert.equal(explorer.subitemText(explorer.getEntry(index, "course-notes").node), "1 item");
  assert.equal(explorer.subitemCount(explorer.getEntry(index, "cheat-sheets-site").node), 0);
  assert.equal(explorer.storageBytes(index.root.node), 3584);
  assert.equal(explorer.storageBytes(null), 0);
  assert.equal(explorer.storageText(index.root.node), "3.5 KB");
  assert.equal(explorer.metadataText(explorer.getEntry(index, "cheat-sheets").node), "3 items, 2.0 KB");
  assert.equal(explorer.typeText(explorer.getEntry(index, "course-notes").node), "File Folder");
  assert.equal(explorer.typeText(explorer.getEntry(index, "course-notes-notes-pdf").node), "PDF Document");
  assert.equal(explorer.typeText(explorer.getEntry(index, "cheat-sheets-site").node), "Internet Shortcut");
});

test("formatStorage rounds like the original explorer", () => {
  assert.equal(explorer.formatStorage(0), "0 KB");
  assert.equal(explorer.formatStorage(512), "512 B");
  assert.equal(explorer.formatStorage(1536), "1.5 KB");
  assert.equal(explorer.formatStorage(10 * 1024 + 600), "11 KB");
  assert.equal(explorer.formatStorage(5 * 1024 * 1024), "5.0 MB");
  assert.equal(explorer.formatStorage(3 * 1024 ** 3), "3.0 GB");
  assert.equal(explorer.formatStorage(2048 * 1024 ** 3), "2048 GB");
});

test("pdfEmbedSrc and thumbnailPages describe the preview frames", () => {
  const { index } = setup();
  const notes = explorer.getEntry(index, "course-notes-notes-pdf").node;
  assert.equal(explorer.pdfEmbedSrc(notes), "assets/x/notes.pdf#page=1&zoom=100&toolbar=0&navpanes=0");
  assert.equal(explorer.pdfEmbedSrc(notes, 2, 55), "assets/x/notes.pdf#page=2&zoom=55&toolbar=0&navpanes=0");
  assert.equal(explorer.pdfEmbedSrc(explorer.getEntry(index, "cheat-sheets-site").node), "");
  assert.deepEqual(explorer.thumbnailPages(notes), [1, 2]);
  assert.deepEqual(explorer.thumbnailPages(explorer.getEntry(index, "cheat-sheets-sheet-pdf").node), [1, 2, 3]);
  assert.deepEqual(explorer.thumbnailPages({ type: "pdf", href: "a", pages: 9 }), [1, 2, 3]);
  assert.deepEqual(explorer.thumbnailPages(null), [1, 2, 3]);
});

test("selection, browsing and the Up action", () => {
  const { index, state } = setup();
  assert.equal(state.selectedId, explorer.ROOT_ID);
  assert.equal(state.viewMode, "list");
  assert.equal(explorer.canGoUp(index, state), false);
  assert.equal(explorer.goUp(index, state), state);
  assert.equal(explorer.browseEntry(index, state), index.root);

  const onPdf = explorer.select(index, state, "cheat-sheets-sheet-pdf");
  assert.equal(explorer.selectedEntry(index, onPdf).node.name, "Sheet.pdf");
  assert.equal(explorer.browseEntry(index, onPdf).id, "cheat-sheets");
  assert.equal(explorer.canGoUp(index, onPdf), true);
  assert.equal(explorer.select(index, onPdf, "missing"), onPdf);

  const up = explorer.goUp(index, onPdf);
  assert.equal(up.selectedId, "cheat-sheets");
  assert.equal(explorer.browseEntry(index, up).id, "cheat-sheets");
  assert.equal(explorer.goUp(index, up).selectedId, explorer.ROOT_ID);
  assert.ok(Object.isFrozen(up));
});

test("folders expand, collapse and open", () => {
  const { index, state } = setup();
  assert.ok(state.expandedIds.has(explorer.ROOT_ID));
  const opened = explorer.expandFolder(index, state, "cheat-sheets");
  assert.ok(opened.expandedIds.has("cheat-sheets"));
  assert.equal(opened.selectedId, explorer.ROOT_ID);
  const closed = explorer.toggleFolder(index, opened, "cheat-sheets");
  assert.ok(!closed.expandedIds.has("cheat-sheets"));
  assert.equal(explorer.toggleFolder(index, state, "cheat-sheets-site"), state);
  assert.equal(explorer.expandFolder(index, state, "missing"), state);

  const entered = explorer.enterFolder(index, state, "cheat-sheets");
  assert.equal(entered.selectedId, "cheat-sheets");
  assert.ok(entered.expandedIds.has("cheat-sheets"));
  assert.equal(explorer.enterFolder(index, state, "cheat-sheets-site"), state);
  assert.deepEqual(
    explorer.childEntries(index, explorer.browseEntry(index, entered)).map((entry) => entry.node.name),
    ["Sheet.pdf", "Site", "Empty"]
  );
});

test("view mode switches and rejects unknown modes", () => {
  const { state } = setup();
  assert.equal(explorer.setViewMode(state, "gallery").viewMode, "gallery");
  assert.equal(explorer.setViewMode(state, "list").viewMode, "list");
  assert.throws(() => explorer.setViewMode(state, "icons"), /Unknown view mode/);
});

test("keyboard navigation steps through the visible tree and the file pane", () => {
  const { index, state } = setup();
  assert.deepEqual(explorer.visibleTreeIds(index, state), [explorer.ROOT_ID, "course-notes", "cheat-sheets"]);
  const opened = explorer.expandFolder(index, state, "cheat-sheets");
  assert.deepEqual(explorer.visibleTreeIds(index, opened), [
    explorer.ROOT_ID,
    "course-notes",
    "cheat-sheets",
    "cheat-sheets-sheet-pdf",
    "cheat-sheets-site",
    "cheat-sheets-empty",
  ]);
  assert.deepEqual(explorer.filePaneIds(index, state), ["course-notes", "cheat-sheets"]);
  const onSite = explorer.select(index, state, "cheat-sheets-site");
  assert.deepEqual(explorer.filePaneIds(index, onSite), [
    "cheat-sheets-sheet-pdf",
    "cheat-sheets-site",
    "cheat-sheets-empty",
  ]);

  const ids = ["a", "b", "c"];
  assert.equal(explorer.stepId(ids, "a", 1), "b");
  assert.equal(explorer.stepId(ids, "c", 1), "c");
  assert.equal(explorer.stepId(ids, "a", -1), "a");
  assert.equal(explorer.stepId(ids, "zzz", 1), "a");
  assert.equal(explorer.stepId([], "a", 1), null);
});
