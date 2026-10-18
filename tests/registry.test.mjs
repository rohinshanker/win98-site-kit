// Every registry package must be complete and self-describing: a valid
// manifest, every listed file present, no unlisted files, assets kept under
// assets/<id>/, and an app module whose id matches the folder.

import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { KINDS, validateManifest } from "../cli/registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = path.join(root, "registry");

const listFiles = async (dir, base = dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, base, files);
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
};

const packages = [];
for (const kind of KINDS) {
  const dir = path.join(registryDir, kind);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) packages.push({ kind, id: entry.name, dir: path.join(dir, entry.name) });
  }
}

test("the registry has packages", () => {
  assert.ok(packages.length > 0);
});

for (const pkg of packages) {
  test(`registry/${pkg.kind}/${pkg.id} is complete`, async () => {
    const manifestPath = path.join(pkg.dir, "manifest.json");
    const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
    assert.equal(manifest.id, pkg.id, "manifest id matches the folder name");
    assert.equal(manifest.kind === "game" ? "games" : "apps", pkg.kind, "kind matches the folder");
    const files = (await listFiles(pkg.dir)).filter((file) => file !== "manifest.json");
    assert.deepEqual([...manifest.files].sort(), files, "files lists exactly the package contents");
    for (const file of manifest.files) {
      assert.ok(
        file.startsWith(`apps/${pkg.id}/`) || file.startsWith(`assets/${pkg.id}/`) || file.startsWith("proxy/"),
        `${file} must live under apps/${pkg.id}/, assets/${pkg.id}/ or proxy/`
      );
      assert.ok((await stat(path.join(pkg.dir, file))).isFile());
    }
    const source = await readFile(path.join(pkg.dir, "apps", pkg.id, "index.js"), "utf8");
    assert.match(source, new RegExp(`id:\\s*"${pkg.id}"`), "app definition id matches");
    assert.doesNotMatch(source, /window\.home[A-Z]/, "no personal-website globals remain");
    assert.doesNotMatch(source, /\bTODO\b|\bFIXME\b/, "no TODOs");
    for (const dependency of manifest.requires ?? []) {
      assert.ok(packages.some((candidate) => candidate.id === dependency), `requires ${dependency} exists`);
    }
  });
}
