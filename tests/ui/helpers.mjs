// Shared Playwright helpers: open the showcase (or template) with console
// and page-error collection, and the four viewports every window must fit.

import { expect } from "@playwright/test";

export const VIEWPORTS = Object.freeze({
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1440, height: 900 },
});

/**
 * Navigates to a site page and returns a diagnostics collector. Call
 * `expectClean()` at the end of the test; it fails on any console error,
 * uncaught exception or failed request seen since the page opened.
 */
export const openSite = async (page, { site = process.env.UI_TEST_SITE || "showcase", hash = "" } = {}) => {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(`/${site}/index.html${hash}`);
  await page.waitForSelector("html.is-desktop-ready");
  return {
    problems,
    expectClean: () => expect(problems, problems.join("\n")).toEqual([]),
  };
};

/**
 * Opens an app window and waits for it to be visible. The dock button is
 * used when the app has one, because open windows can cover desktop icons
 * on small viewports.
 */
export const openApp = async (page, id) => {
  const dock = page.locator(`.taskbar-icon[data-app="${id}"]`);
  if (await dock.count()) await dock.click();
  else await page.click(`.desktop-icon[data-app="${id}"]`);
  const win = page.locator(`[data-app-window="${id}"]`);
  await expect(win).toBeVisible();
  await expect(win).not.toHaveClass(/is-opening/);
  return win;
};

/** Asserts a window's title bar sits fully inside the viewport above the taskbar. */
export const expectWindowReachable = async (page, win) => {
  const viewport = page.viewportSize();
  const taskbar = await page.locator(".taskbar").boundingBox();
  const title = await win.locator(".title-bar").first().boundingBox();
  expect(title, "title bar should render").not.toBeNull();
  expect(title.y).toBeGreaterThanOrEqual(0);
  expect(title.x).toBeGreaterThanOrEqual(0);
  expect(title.x + title.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(title.y + title.height).toBeLessThanOrEqual(taskbar.y + 1);
  const box = await win.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
};
