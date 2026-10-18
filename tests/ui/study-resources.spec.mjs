// Study Resources: the explorer window opens at every viewport, folders
// navigate, a selected PDF previews and enables its actions, and the
// viewer window loads and unloads the PDF.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const NOTES_ID = "course-notes-sample-notes-pdf";
const NOTES_HREF = "assets/study-resources/sample-notes.pdf";

/**
 * Chromium's PDF plugin leaves two artefacts the kit's collector would count:
 * the headless shell has no in-page viewer, so a PDF iframe (or a download)
 * aborts its navigation with net::ERR_ABORTED, and the full viewer's own WebUI
 * stylesheet fails from chrome://resources. Neither comes from the site, so
 * they are dropped and the asset is instead checked with a direct request.
 */
const PDF_PLUGIN_NOISE = [
  /^request failed: .*\/assets\/study-resources\/[^/]+\.pdf \(net::ERR_ABORTED\)$/,
  /^console: Failed to load resource: net::ERR_FAILED @ chrome:\/\/resources\//,
];

const expectCleanBesidesPdfPlugin = async (page, site) => {
  const response = await page.request.get(`/${process.env.UI_TEST_SITE || "showcase"}/${NOTES_HREF}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  const remaining = site.problems.filter((problem) => !PDF_PLUGIN_NOISE.some((pattern) => pattern.test(problem)));
  expect(remaining, remaining.join("\n")).toEqual([]);
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`opens without overflow at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const site = await openSite(page);
    const win = await openApp(page, "study-resources");
    await expectWindowReachable(page, win);
    await expect(win.locator('[data-study-part="address"]')).toHaveText("Study Resources");
    await expect(win.locator('[data-study-file="course-notes"]')).toBeVisible();
    await expect(win.locator('[data-study-action="up"]')).toBeDisabled();
    await expect(win.locator('[data-study-action="open-window"]')).toBeDisabled();
    await expect(win.locator(".study-toolbar img").first()).toHaveAttribute("src", /directory_open\.ico$/);
    const explorerBox = await win.locator(".study-explorer").boundingBox();
    const winBox = await win.boundingBox();
    expect(explorerBox.x + explorerBox.width).toBeLessThanOrEqual(winBox.x + winBox.width);
    expect(explorerBox.y + explorerBox.height).toBeLessThanOrEqual(winBox.y + winBox.height + 1);
    expect(await win.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    site.expectClean();
  });
}

test("opens a folder, previews a PDF and shows it in the viewer window", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "study-resources");

  await win.locator('[data-study-file="course-notes"]').dblclick();
  await expect(win.locator('[data-study-part="address"]')).toHaveText("Study Resources\\Course Notes");
  await expect(win.locator('[data-study-select="course-notes"]')).toHaveClass(/is-selected/);
  await expect(win.locator('[data-study-action="up"]')).toBeEnabled();

  const pdf = win.locator(`[data-study-file="${NOTES_ID}"]`);
  await pdf.click();
  await expect(pdf).toHaveClass(/is-selected/);
  await expect(win.locator('[data-study-part="preview-title"]')).toHaveText("Sample Notes.pdf");
  const mainFrame = win.locator(".study-pdf-main iframe");
  await expect(mainFrame).toHaveAttribute("src", /sample-notes\.pdf#page=1/);
  await expect(win.locator(".study-pdf-thumbnail")).toHaveCount(1);
  await expect(win.locator('[data-study-part="status-left"]')).toHaveText("1 object, 632 B");
  await expect(win.locator('[data-study-action="open-window"]')).toBeEnabled();
  await expect(win.locator('[data-study-action="open-tab"]')).toBeEnabled();
  await expect(win.locator('[data-study-action="download"]')).toBeEnabled();

  await win.locator('[data-study-action="open-window"]').click();
  const viewer = page.locator('[data-app-window="study-pdf"]');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".title-bar-text")).toHaveText("Sample Notes.pdf");
  const viewerFrame = viewer.locator("iframe");
  await expect(viewerFrame).toHaveAttribute("src", /sample-notes\.pdf#page=1/);
  await expectWindowReachable(page, viewer);
  await viewer.locator('[data-close="study-pdf"]').click();
  await expect(viewer).toBeHidden();
  await expect(viewerFrame).not.toHaveAttribute("src", /.+/);

  await win.locator('[data-study-action="up"]').click();
  await expect(win.locator('[data-study-part="address"]')).toHaveText("Study Resources\\Course Notes");
  await expect(win.locator('[data-study-action="open-window"]')).toBeDisabled();
  await expectCleanBesidesPdfPlugin(page, site);
});

test("gallery view, link entries and keyboard navigation", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.wide);
  const site = await openSite(page);
  const win = await openApp(page, "study-resources");
  const filePane = win.locator('[data-study-part="file-pane"]');

  await win.locator('[data-study-action="gallery"]').click();
  await expect(filePane).toHaveClass(/is-gallery/);
  await expect(win.locator('[data-study-action="gallery"]')).toHaveAttribute("aria-pressed", "true");
  await expect(win.locator(".study-file-list-header")).toHaveCount(0);

  const sheets = win.locator('[data-study-file="cheat-sheets"]');
  await sheets.focus();
  await page.keyboard.press("Enter");
  await expect(win.locator('[data-study-part="current-title"]')).toHaveText("Cheat Sheets");
  await expect(win.locator('[data-study-file="cheat-sheets-sample-cheat-sheet-pdf"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(win.locator('[data-study-file="cheat-sheets-sample-cheat-sheet-pdf"]')).toHaveClass(/is-selected/);
  await page.keyboard.press("ArrowDown");
  const link = win.locator('[data-study-file="cheat-sheets-khan-academy"]');
  await expect(link).toHaveClass(/is-selected/);
  await expect(link).toBeFocused();
  await expect(win.locator(".study-preview-link-href")).toHaveText("https://www.khanacademy.org/");
  await expect(win.locator('[data-study-action="open-tab"]')).toBeEnabled();
  await expect(win.locator('[data-study-action="open-window"]')).toBeDisabled();
  await expect(win.locator('[data-study-action="download"]')).toBeDisabled();

  await page.evaluate(() => {
    window.__openedTabs = [];
    window.open = (...args) => {
      window.__openedTabs.push(args);
      return null;
    };
  });
  await win.locator('[data-study-action="open-tab"]').click();
  expect(await page.evaluate(() => window.__openedTabs)).toEqual([
    ["https://www.khanacademy.org/", "_blank", "noopener,noreferrer"],
  ]);

  await link.focus();
  await page.keyboard.press("Backspace");
  await expect(win.locator('[data-study-part="address"]')).toHaveText("Study Resources\\Cheat Sheets");
  await expect(win.locator('[data-study-file="cheat-sheets-sample-cheat-sheet-pdf"]')).toBeVisible();

  const treeRoot = win.locator(`[data-study-select="study-resources"]`);
  await treeRoot.click();
  await treeRoot.focus();
  await page.keyboard.press("ArrowDown");
  await expect(win.locator('[data-study-select="course-notes"]')).toHaveClass(/is-selected/);
  await page.keyboard.press("ArrowRight");
  await expect(win.locator(`[data-study-select="${NOTES_ID}"]`)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(win.locator(`[data-study-select="${NOTES_ID}"]`)).toHaveCount(0);
  await expect(win.locator('[data-study-select="course-notes"]')).toBeFocused();
  await expectCleanBesidesPdfPlugin(page, site);
});

test("download hands the PDF to the browser", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "study-resources");
  await win.locator('[data-study-file="course-notes"]').dblclick();
  await win.locator(`[data-study-file="${NOTES_ID}"]`).click();
  const downloadPromise = page.waitForEvent("download");
  await win.locator('[data-study-action="download"]').click();
  const download = await downloadPromise;
  // Chromium sometimes reports the served name instead of the download attribute.
  expect(download.suggestedFilename()).toMatch(/^(?:Sample Notes|sample-notes)\.pdf$/);
  await download.cancel();
  await expectCleanBesidesPdfPlugin(page, site);
});
