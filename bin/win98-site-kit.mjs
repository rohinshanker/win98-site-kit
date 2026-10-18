#!/usr/bin/env node
import { run } from "../cli/main.js";

run(process.argv.slice(2)).catch((error) => {
  console.error(`win98-site-kit: ${error.message}`);
  process.exitCode = 1;
});
