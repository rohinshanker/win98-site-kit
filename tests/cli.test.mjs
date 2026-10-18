import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, run } from "../cli/main.js";
import { createRegistry, validateManifest } from "../cli/registry.js";
import { contentTypeFor } from "../cli/serve.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = path.join(root, "registry");

const exists = (target) => stat(target).then(() => true, () => false);

const scratch = async () => mkdtemp(path.join(os.tmpdir(), "win98-cli-"));

test("parseArgs reads commands, options and rejects bad input", () => {
  assert.deepEqual(parseArgs(["add", "snake", "--dir", "site", "--force"]), {
    command: "add",
    args: ["snake"],
    options: { dir: "site", registry: "", force: true, port: 4173, help: false },
  });
  assert.equal(parseArgs(["serve", "--port=0"]).options.port, 0);
  assert.equal(parseArgs([]).command, "help");
  assert.throws(() => parseArgs(["--port", "abc"]), /--port/);
  assert.throws(() => parseArgs(["--dir"]), /needs a value/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown option/);
});

test("init copies the template, add/remove install packages and sync regenerates installed.js", async () => {
  const dir = await scratch();
  try {
    const site = path.join(dir, "site");
    const lines = [];
    const log = (line) => lines.push(line);
    await run(["init", site], { log });
    assert.ok(await exists(path.join(site, "kit", "boot.js")));
    assert.ok(await exists(path.join(site, "assets", "app-icons", "ico", "windows.ico")));
    await assert.rejects(run(["init", site], { log }), /not empty/);

    const added = await run(["add", "writing", "--dir", site, "--registry", registryDir], { log });
    assert.ok(added.written.includes("apps/writing/index.js"));
    assert.ok(added.written.includes("apps/writing/manifest.json"));
    const installed = await readFile(path.join(site, "apps", "installed.js"), "utf8");
    assert.match(installed, /import writing from "\.\/writing\/index\.js";/);
    assert.match(installed, /export default \[.*writing.*\];/);
    await assert.rejects(
      run(["add", "writing", "--dir", site, "--registry", registryDir], { log }),
      /would overwrite/
    );
    await run(["add", "writing", "--dir", site, "--registry", registryDir, "--force"], { log });

    const listed = await run(["list", "--dir", site, "--registry", registryDir], { log });
    assert.ok(listed.installed.includes("writing"));
    assert.ok(listed.packages.some((entry) => entry.id === "writing"));
    assert.match(lines.join("\n"), /writing\s+app\s+\[installed\]/);

    const removed = await run(["remove", "writing", "--dir", site], { log });
    assert.ok(removed.removed.includes("apps/writing/index.js"));
    assert.equal(await exists(path.join(site, "apps", "writing")), false);
    assert.equal(await exists(path.join(site, "assets", "writing")), false);
    assert.doesNotMatch(await readFile(path.join(site, "apps", "installed.js"), "utf8"), /writing/);

    await mkdir(path.join(site, "apps", "hello-world"));
    await writeFile(path.join(site, "apps", "hello-world", "index.js"), "export default {};\n");
    const synced = await run(["sync", "--dir", site], { log });
    assert.ok(synced.ids.includes("hello-world"));
    assert.match(await readFile(path.join(site, "apps", "installed.js"), "utf8"), /import helloWorld from/);

    await assert.rejects(run(["add", "nope", "--dir", site, "--registry", registryDir], { log }), /Unknown package/);
    await assert.rejects(run(["sync", "--dir", dir], { log }), /not a win98-site-kit site/);
    await assert.rejects(run(["frobnicate"], { log }), /Unknown command/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a remote registry is read through fetch", async () => {
  const dir = await scratch();
  try {
    const site = path.join(dir, "site");
    await run(["init", site], { log: () => {} });
    const base = "https://example.test/registry";
    const fetchImpl = async (url) => {
      const relative = url.slice(base.length + 1);
      if (relative === "index.json") {
        return { ok: true, text: async () => JSON.stringify({ packages: [{ id: "writing", kind: "app" }] }) };
      }
      const file = path.join(registryDir, relative);
      if (!(await exists(file))) return { ok: false, status: 404 };
      const bytes = await readFile(file);
      return { ok: true, text: async () => bytes.toString("utf8"), arrayBuffer: async () => bytes };
    };
    const registry = await createRegistry({ base, fetchImpl });
    assert.equal(registry.remote, true);
    const manifest = await registry.manifest("writing");
    assert.equal(manifest.id, "writing");
    const { addPackage } = await import("../cli/site.js");
    const written = await addPackage(site, registry, "writing");
    assert.ok(written.includes("apps/writing/index.js"));
    await assert.rejects(registry.file("writing", "missing.txt"), /404/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateManifest catches malformed manifests", () => {
  const good = { id: "x", kind: "app", title: "X", description: "d", files: ["apps/x/index.js"] };
  assert.equal(validateManifest(good), good);
  assert.throws(() => validateManifest({ ...good, id: "Bad" }), /kebab-case/);
  assert.throws(() => validateManifest({ ...good, kind: "widget" }), /kind/);
  assert.throws(() => validateManifest({ ...good, files: [] }), /files/);
  assert.throws(() => validateManifest({ ...good, files: ["../x"] }), /relative POSIX path/);
  assert.throws(() => validateManifest({ ...good, files: ["apps/y/index.js"] }), /apps\/x\/index\.js/);
  assert.throws(() => validateManifest({ ...good, requires: ["Nope"] }), /requires/);
});

test("serve answers with the right types and 404s cleanly", async () => {
  const dir = await scratch();
  try {
    const site = path.join(dir, "site");
    await run(["init", site], { log: () => {} });
    const { server } = await run(["serve", site, "--port", "0"], { log: () => {}, keepServing: false });
    try {
      const index = await fetch(`${server.url}index.html`);
      assert.equal(index.status, 200);
      assert.match(index.headers.get("content-type"), /text\/html/);
      const module = await fetch(`${server.url}kit/boot.js`);
      assert.match(module.headers.get("content-type"), /text\/javascript/);
      const icon = await fetch(`${server.url}assets/app-icons/ico/windows.ico`);
      assert.equal(icon.headers.get("content-type"), "image/x-icon");
      const missing = await fetch(`${server.url}nope.html`);
      assert.equal(missing.status, 404);
      const traversal = await fetch(`${server.url}..%2F..%2Fetc%2Fpasswd`);
      assert.ok([403, 404].includes(traversal.status));
      const rootIndex = await fetch(server.url);
      assert.equal(rootIndex.status, 200);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(contentTypeFor("x.woff2"), "font/woff2");
  assert.equal(contentTypeFor("x.unknown"), "application/octet-stream");
});
