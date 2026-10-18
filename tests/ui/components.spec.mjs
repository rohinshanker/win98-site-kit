// Components window: opens at every viewport, every section switches, an
// alert resolves with the pressed button, the extra window opens, and the
// icon browser finds notepad. Run against a site that has the package:
//   UI_TEST_SITE=tmp/components-site npx playwright test tests/ui/components.spec.mjs

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";
import { EXTRA_WINDOW_ID, SECTION_IDS } from "../../registry/apps/components/apps/components/sections.js";

const selectSection = async (win, id) => {
  await win.locator(`.selector-item[data-view="${id}"]`).click();
  const panel = win.locator(`.viewer-content[data-view="${id}"]`);
  await expect(panel).toBeVisible();
  return panel;
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`opens and switches every section at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const site = await openSite(page);
    const win = await openApp(page, "components");
    await expectWindowReachable(page, win);
    for (const id of SECTION_IDS) {
      const panel = await selectSection(win, id);
      await expect(panel.locator(".code-sample").first()).toBeVisible();
      const box = await panel.boundingBox();
      expect(box.x + box.width, `${id} panel fits horizontally`).toBeLessThanOrEqual(viewport.width + 1);
    }
    await expect(win.locator('[data-view="spacing"] [data-token="--frame-padding"]')).toHaveText("6px");
    site.expectClean();
  });
}

test("alerts resolve with the pressed button", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "components");
  const panel = await selectSection(win, "alerts");
  const result = panel.locator("[data-alert-result]");

  await panel.locator('[data-alert="one"]').click();
  const alert = page.locator(".system-alert-window:visible");
  await expect(alert).toBeVisible();
  await alert.locator('[data-alert-button="ok"]').click();
  await expect(result).toHaveText('showAlert resolved with "ok"');
  // showAlert resolves before the close animation ends; one-off alerts are removed after it.
  await expect(alert).toBeHidden();

  // 98.css hides the native radio; its label is the clickable control.
  await panel.locator('label[for="components-align-center"]').click();
  await expect(panel.locator("#components-align-center")).toBeChecked();
  await panel.locator('[data-alert="three"]').click();
  const confirm = page.locator(".system-alert-window:visible");
  await expect(confirm.locator("[data-button-alignment]")).toHaveAttribute("data-button-alignment", "center");
  await expect(confirm.locator("[data-alert-button]")).toHaveCount(3);
  await confirm.locator('[data-alert-button="no"]').click();
  await expect(result).toHaveText('showAlert resolved with "no"');
  await expect(confirm).toBeHidden();

  await panel.locator('[data-alert="image"]').click();
  const picture = page.locator(".system-alert-window:visible");
  await expect(picture.locator(".system-alert-image img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(result).toHaveText('showAlert resolved with "dismiss"');
  site.expectClean();
});

test("the windows section opens and closes the extra window", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.wide);
  const site = await openSite(page);
  const win = await openApp(page, "components");
  const panel = await selectSection(win, "windows");
  await panel.locator(`[data-open-window="${EXTRA_WINDOW_ID}"]`).click();
  const extra = page.locator(`[data-app-window="${EXTRA_WINDOW_ID}"]`);
  await expect(extra).toBeVisible();
  await expect(extra).toHaveAttribute("role", "dialog");
  await expect(panel.locator("[data-window-state]")).toHaveText("Extra window: open");
  await extra.locator("[data-close-extra]").click();
  await expect(extra).toBeHidden();
  await expect(panel.locator("[data-window-state]")).toHaveText("Extra window: closed");
  site.expectClean();
});

test("the icon browser searches, pages and reports a path", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  const site = await openSite(page);
  const win = await openApp(page, "components");
  const panel = await selectSection(win, "icons");
  await expect(panel.locator("[data-icon-status]")).toHaveText("626 icons");
  const cells = panel.locator(".icon-cell");
  expect(await cells.count()).toBeLessThanOrEqual(40);
  await expect(panel.locator("[data-icon-page]")).toHaveText("1 of 16");

  await panel.locator("[data-icon-next]").click();
  await expect(panel.locator("[data-icon-page]")).toHaveText("2 of 16");

  await panel.locator("#components-icon-search").fill("notepad");
  await expect(panel.locator("[data-icon-status]")).toHaveText(/^\d+ of 626 icons match "notepad"$/);
  await expect(panel.locator("[data-icon-page]")).toHaveText("1 of 1");
  const notepad = panel.locator('.icon-cell[data-icon="notepad.ico"]');
  await expect(notepad).toBeVisible();
  await expect.poll(() => notepad.locator("img").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await notepad.click();
  await expect(panel.locator("#components-icon-path")).toHaveValue("assets/app-icons/ico/notepad.ico");
  await expect(panel.locator("[data-icon-copy-note]")).toHaveText(/Copied|Clipboard not available/);

  await panel.locator("#components-icon-search").fill("zzzz-nothing");
  await expect(panel.locator(".icon-grid-empty")).toBeVisible();
  site.expectClean();
});
