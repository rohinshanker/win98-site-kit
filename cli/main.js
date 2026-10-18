// Command dispatcher for bin/win98-site-kit.mjs. Kept separate so tests can
// call `run(argv)` without spawning a process.

import path from "node:path";
import { createRegistry } from "./registry.js";
import { addPackage, initSite, installedIds, removePackage, syncInstalled } from "./site.js";
import { serveDirectory } from "./serve.js";

const USAGE = `win98-site-kit — build a Windows 98 style desktop website

Usage:
  win98-site-kit init [dir]              Copy the starter site into dir (default: .)
  win98-site-kit add <package> [--dir d] Download a game or app into the site
  win98-site-kit remove <package> [--dir d]
  win98-site-kit list [--dir d]          Show registry packages and what is installed
  win98-site-kit sync [--dir d]          Regenerate apps/installed.js from apps/*/
  win98-site-kit serve [dir] [--port n]  Serve a site directory locally

Options:
  --dir <path>        Site directory (default: current directory)
  --registry <src>    Registry directory or URL (default: bundled, else GitHub)
  --force             Overwrite existing files (add) or a non-empty directory (init)
  --port <n>          Port for serve (default 4173)
  -h, --help          Show this help
`;

export const parseArgs = (argv) => {
  const positional = [];
  const options = { dir: ".", registry: "", force: false, port: 4173, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir" || arg === "--registry" || arg === "--port") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = arg === "--port" ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--dir=") || arg.startsWith("--registry=") || arg.startsWith("--port=")) {
      const [key, value] = arg.slice(2).split("=");
      options[key] = key === "port" ? Number(value) : value;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535");
  }
  return { command: positional[0] ?? "help", args: positional.slice(1), options };
};

/**
 * Runs a CLI command. `io.log` receives output lines; `io.keepServing` set to
 * false makes `serve` return the server instead of blocking (tests use it).
 */
export const run = async (argv, io = {}) => {
  const log = io.log ?? ((line) => console.log(line));
  const { command, args, options } = parseArgs(argv);
  if (options.help || command === "help") {
    log(USAGE);
    return { command: "help" };
  }
  const dir = path.resolve(options.dir);

  switch (command) {
    case "init": {
      const target = await initSite(args[0] ?? dir, { force: options.force });
      log(`Created a desktop site in ${target}`);
      log("Next:");
      log(`  cd ${path.relative(process.cwd(), target) || "."}`);
      log("  npx win98-site-kit serve      # open http://127.0.0.1:4173/");
      log("  npx win98-site-kit add snake  # download a game");
      log("  edit site.config.js           # title, background, icons, calendar");
      return { command, target };
    }
    case "add": {
      if (!args.length) throw new Error("add needs a package name (try: win98-site-kit list)");
      const registry = await createRegistry({ base: options.registry });
      const written = [];
      for (const id of args) {
        log(`Adding ${id} from ${registry.source}`);
        written.push(...(await addPackage(dir, registry, id, { force: options.force, log })));
      }
      log(`Wrote ${written.length} files and updated apps/installed.js`);
      return { command, written };
    }
    case "remove": {
      if (!args.length) throw new Error("remove needs a package name");
      const removed = [];
      for (const id of args) removed.push(...(await removePackage(dir, id)));
      log(`Removed ${removed.length} files and updated apps/installed.js`);
      return { command, removed };
    }
    case "list": {
      const registry = await createRegistry({ base: options.registry });
      const { packages } = await registry.index();
      let installed = [];
      try {
        installed = await installedIds(dir);
      } catch {
        installed = [];
      }
      log(`Registry: ${registry.source}`);
      for (const entry of packages) {
        const mark = installed.includes(entry.id) ? "[installed]" : "[available]";
        log(`  ${entry.id.padEnd(18)} ${entry.kind.padEnd(5)} ${mark} ${entry.title} — ${entry.description}`);
      }
      return { command, packages, installed };
    }
    case "sync": {
      const ids = await syncInstalled(dir);
      log(`apps/installed.js lists ${ids.length} apps: ${ids.join(", ")}`);
      return { command, ids };
    }
    case "serve": {
      const root = path.resolve(args[0] ?? dir);
      const server = await serveDirectory(root, { port: options.port });
      log(`Serving ${root} at ${server.url}`);
      if (io.keepServing === false) return { command, server };
      await new Promise(() => {});
      return { command };
    }
    default:
      throw new Error(`Unknown command "${command}". Run win98-site-kit --help.`);
  }
};
