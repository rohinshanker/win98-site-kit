// `node --check` for every authored JavaScript file (template, registry,
// CLI, scripts and tests). Fails on the first file that does not parse.

import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["bin", "cli", "registry", "scripts", "template", "tests"];
const SKIP = new Set(["node_modules", "showcase", ".playwright-cli", "test-results"]);

const walk = async (dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (/\.(m?js)$/.test(entry.name)) files.push(full);
  }
  return files;
};

const files = (await Promise.all(ROOTS.map((name) => walk(path.join(root, name)).catch(() => [])))).flat();
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
console.log(`syntax ok: ${files.length} files`);
