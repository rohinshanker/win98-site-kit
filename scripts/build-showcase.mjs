// Regenerates showcase/ from template/ plus every registry package, then
// overlays showcase-src/ (config and demo-only files). `--check` rebuilds
// into a temporary directory and fails when it differs from showcase/.

import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../cli/registry.js";
import { addPackage, initSite } from "../cli/site.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOWCASE = path.join(root, "showcase");
const OVERLAY = path.join(root, "showcase-src");

export const buildShowcase = async (target) => {
  await rm(target, { recursive: true, force: true });
  await initSite(target);
  const registry = await createRegistry({ base: path.join(root, "registry") });
  const { packages } = await registry.index();
  for (const entry of packages) {
    await addPackage(target, registry, entry.id, { force: true });
  }
  await cp(OVERLAY, target, { recursive: true, force: true });
  return packages.map((entry) => entry.id);
};

const listFiles = async (dir, base = dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, base, files);
    else files.push(path.relative(base, full));
  }
  return files.sort();
};

const sameFile = async (a, b) => {
  const [first, second] = await Promise.all([readFile(a), readFile(b)]);
  return first.equals(second);
};

const check = async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "win98-showcase-"));
  try {
    const fresh = path.join(scratch, "showcase");
    await buildShowcase(fresh);
    const exists = await stat(SHOWCASE).catch(() => null);
    if (!exists) throw new Error("showcase/ is missing; run npm run showcase:build");
    const [expected, actual] = await Promise.all([listFiles(fresh), listFiles(SHOWCASE)]);
    const differences = [];
    for (const file of expected) if (!actual.includes(file)) differences.push(`missing: ${file}`);
    for (const file of actual) if (!expected.includes(file)) differences.push(`extra: ${file}`);
    for (const file of expected) {
      if (actual.includes(file) && !(await sameFile(path.join(fresh, file), path.join(SHOWCASE, file)))) {
        differences.push(`changed: ${file}`);
      }
    }
    if (differences.length) {
      throw new Error(`showcase/ is stale (run npm run showcase:build):\n  ${differences.join("\n  ")}`);
    }
    console.log(`showcase ok: ${expected.length} files`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const task = process.argv.includes("--check")
    ? check()
    : buildShowcase(SHOWCASE).then((ids) => console.log(`showcase built with ${ids.length} packages: ${ids.join(", ")}`));
  task.catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
