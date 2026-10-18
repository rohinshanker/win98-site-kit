// Neko package: at every viewport the desktop icon wakes a cat that follows
// the pointer, the launcher context menu runs /nekostream through the
// System Alert confirmation, the stream fills the taskbar lane, and the
// icon sends the cat back to bed.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, openSite } from "./helpers.mjs";

const ICON = '.desktop-icon[data-app="neko"]';
const CAT = ".desktop-neko-cat";
const MENU = "#neko-context-menu";
const ALERT = '[data-app-window="neko-stream-alert"]';
const STREAM_CAT = "#neko-stream-layer .neko-stream-cat";

const catPosition = (page) =>
  page.locator(CAT).evaluate((el) => ({ x: Number.parseFloat(el.style.left), y: Number.parseFloat(el.style.top) }));

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`neko wakes, chases the pointer, streams and sleeps at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    const site = await openSite(page);
    const icon = page.locator(ICON);

    // The bed icon replaces the plain image and the dock shows the awake sprite.
    await expect(icon.locator(".neko-icon-bed")).toBeVisible();
    await expect(icon.locator("[data-neko-sleeping-cat]")).toHaveAttribute("src", /sleep[12]\.png$/);
    await expect(page.locator('.taskbar-icon[data-app="neko"] img')).toHaveAttribute("src", /awake\.png$/);

    // Wake: the cat appears on the bed and runs its wake sequence before chasing.
    await icon.click();
    const cat = page.locator(CAT);
    await expect(cat).toBeVisible();
    await expect(icon.locator("[data-neko-icon]")).toHaveClass(/is-awake/);
    await expect(page.locator('.taskbar-icon[data-app="neko"] img')).toHaveAttribute("src", /sleep1\.png$/);
    const target = { x: size.width - 60, y: 120 };
    await page.mouse.move(target.x, target.y);
    const home = await catPosition(page);
    await expect(cat).toHaveAttribute("src", /(up|down|left|right)[a-z]*[12]\.png$/, { timeout: 10_000 });
    await page.waitForTimeout(1200);
    const chased = await catPosition(page);
    expect(distance(chased, target)).toBeLessThan(distance(home, target) - 40);
    await expect(page.locator(".desktop-neko-footprint").first()).toBeAttached();

    // Context menu via keyboard (the parked cat is clickable and may sit near the pointer).
    await icon.focus();
    await page.keyboard.press("Shift+F10");
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    await expect(icon).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#neko-stream-command")).toBeFocused();
    const menuBox = await menu.boundingBox();
    const taskbar = await page.locator(".taskbar").boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(size.width + 1);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(taskbar.y + 1);

    // Escape closes the menu and returns focus; No closes the alert without a stream.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(icon).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Enter");
    const alert = page.locator(ALERT);
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Trigger /nekostream?");
    await expect(alert.locator('[data-alert-button="yes"]')).toBeFocused();
    await expect(alert.locator(".system-alert-message img")).toHaveAttribute("src", /sleep1\.png$/);
    await alert.locator('[data-alert-button="no"]').click();
    await expect(alert).toBeHidden();
    await expect(icon).toBeFocused();
    expect(await page.locator(STREAM_CAT).count()).toBe(0);

    // Yes starts the stream; cats run along the taskbar lane.
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(alert).toBeVisible();
    await expect(alert.locator('[data-alert-button="yes"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(alert).toBeHidden();
    await expect(page.locator(STREAM_CAT).first()).toBeAttached({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(await page.locator(STREAM_CAT).count()).toBeGreaterThan(1);
    const lane = await page.locator(STREAM_CAT).first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, sprite: el.dataset.sprite, mode: el.dataset.mode };
    });
    // Stream cats run, scratch the edges and nap at random; any mode is valid.
    expect(["running", "scratch", "sleep", "idle", "napping"]).toContain(lane.mode);
    expect(lane.bottom).toBeGreaterThan(taskbar.y);
    expect(lane.top).toBeLessThan(taskbar.y);

    // Clicking the icon sends the cat home; it disappears when it reaches the bed.
    await page.mouse.move(200, 300);
    await page.waitForTimeout(600);
    await icon.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('.taskbar-icon[data-app="neko"] img')).toHaveAttribute("src", /awake\.png$/);
    await expect(cat).toBeHidden({ timeout: 20_000 });
    await expect(icon.locator("[data-neko-icon]")).not.toHaveClass(/is-awake/);

    site.expectClean();
  });
}
