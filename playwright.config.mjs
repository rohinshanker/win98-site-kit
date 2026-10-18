import { defineConfig } from "@playwright/test";

// The suite serves the repository root, so specs address the generated
// showcase at /showcase/ and the bare template at /template/. Each checkout
// should set its own UI_TEST_PORT so parallel worktrees never share a server.
const port = Number(process.env.UI_TEST_PORT || 4390);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: process.env.UI_TEST_OUTPUT_DIR || "./test-results",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "ui" }],
  webServer: {
    command: `node bin/win98-site-kit.mjs serve . --port ${port}`,
    url: `${baseURL}/showcase/index.html`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
