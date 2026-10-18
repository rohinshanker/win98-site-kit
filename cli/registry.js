// Registry access: lists packages (apps and games) and reads their files
// from the local registry/ folder that ships with the kit, or from a remote
// base URL (raw GitHub by default when no local registry is present).

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KINDS = Object.freeze(["apps", "games"]);

export const DEFAULT_REMOTE_REGISTRY =
  "https://raw.githubusercontent.com/rohinshanker/win98-site-kit/main/registry";

export const packageRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const localRegistryDir = () => path.join(packageRoot(), "registry");

const isDirectory = async (target) => {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

const MANIFEST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validates a package manifest; throws on the first problem it finds. */
export const validateManifest = (manifest, source = "manifest.json") => {
  const fail = (message) => {
    throw new Error(`${source}: ${message}`);
  };
  if (!manifest || typeof manifest !== "object") fail("must be a JSON object");
  if (typeof manifest.id !== "string" || !MANIFEST_ID.test(manifest.id)) fail("id must be kebab-case");
  if (!["app", "game"].includes(manifest.kind)) fail('kind must be "app" or "game"');
  if (typeof manifest.title !== "string" || !manifest.title.trim()) fail("title is required");
  if (typeof manifest.description !== "string" || !manifest.description.trim()) fail("description is required");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail("files must be a non-empty array");
  for (const file of manifest.files) {
    if (typeof file !== "string" || file.startsWith("/") || file.includes("..") || file.includes("\\")) {
      fail(`files entry "${file}" must be a relative POSIX path inside the site`);
    }
  }
  if (!manifest.files.includes(`apps/${manifest.id}/index.js`)) {
    fail(`files must include apps/${manifest.id}/index.js`);
  }
  if (manifest.requires !== undefined) {
    if (!Array.isArray(manifest.requires) || manifest.requires.some((id) => !MANIFEST_ID.test(id))) {
      fail("requires must be an array of package ids");
    }
  }
  return manifest;
};

/**
 * Creates a registry reader. With `base` unset it uses the kit's own
 * registry/ folder when present and the remote registry otherwise. `base`
 * may be a directory path or an http(s) URL.
 */
export const createRegistry = async ({ base = "", fetchImpl = globalThis.fetch } = {}) => {
  let source = base;
  if (!source) source = (await isDirectory(localRegistryDir())) ? localRegistryDir() : DEFAULT_REMOTE_REGISTRY;
  const remote = /^https?:\/\//.test(source);

  const readText = async (relativePath) => {
    if (remote) {
      const url = `${source.replace(/\/$/, "")}/${relativePath}`;
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Registry fetch failed (${response.status}) for ${url}`);
      return response.text();
    }
    return readFile(path.join(source, relativePath), "utf8");
  };

  const readBytes = async (relativePath) => {
    if (remote) {
      const url = `${source.replace(/\/$/, "")}/${relativePath}`;
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Registry fetch failed (${response.status}) for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    return readFile(path.join(source, relativePath));
  };

  /** The registry index: `{ packages: [{ id, kind, title, description }] }`. */
  const index = async () => {
    if (remote) return JSON.parse(await readText("index.json"));
    const packages = [];
    for (const kind of KINDS) {
      const dir = path.join(source, kind);
      if (!(await isDirectory(dir))) continue;
      for (const entry of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
        const manifestPath = path.join(dir, entry.name, "manifest.json");
        const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
        packages.push({
          id: manifest.id,
          kind: manifest.kind,
          title: manifest.title,
          description: manifest.description,
          requires: manifest.requires ?? [],
        });
      }
    }
    packages.sort((a, b) => a.id.localeCompare(b.id));
    return { packages };
  };

  const locate = async (id) => {
    const { packages } = await index();
    const entry = packages.find((candidate) => candidate.id === id);
    if (!entry) {
      throw new Error(`Unknown package "${id}". Available: ${packages.map((p) => p.id).join(", ")}`);
    }
    return `${entry.kind === "game" ? "games" : "apps"}/${id}`;
  };

  const manifest = async (id) => {
    const dir = await locate(id);
    return validateManifest(JSON.parse(await readText(`${dir}/manifest.json`)), `${dir}/manifest.json`);
  };

  const file = async (id, relativePath) => readBytes(`${await locate(id)}/${relativePath}`);

  return Object.freeze({ source, remote, index, manifest, file });
};
