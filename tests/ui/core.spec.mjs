// The desktop shell itself: boot without errors at every viewport, open the
// template apps, drag and resize windows, the calendar, alerts, Display
// Properties persistence, deep links and the Start button.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const TEMPLATE_APPS = ["about", "projects", "socials", "credits", "cursor-settings", "display-properties"];

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`every template window is reachable at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const diagnostics = await openSite(page);
    await expect(page.locator(".desktop-icon")).toHaveCount(await page.locator(".desktop-icon").count());
    for (const id of TEMPLATE_APPS) {
      const win = await openApp(page, id);
      await expectWindowReachable(page, win);
      await expect(page.locator(`.taskbar-icon[data-app="${id}"]`)).toHaveAttribute("aria-pressed", "true");
      await win.locator('[data-window-control="close"]').click();
      await expect(win).toBeHidden();
      await expect(page.locator(`.taskbar-icon[data-app="${id}"]`)).toHaveAttribute("aria-pressed", "false");
    }
    diagnostics.expectClean();
  });
}

test("link apps open a new tab instead of a window", async ({ page, context }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const diagnostics = await openSite(page);
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.click('.desktop-icon[data-app="my-site"]'),
  ]);
  expect(popup.url()).toMatch(/^https:\/\/rohin\.shanker\.me\/?/);
  await popup.close();
  await expect(page.locator("[data-app-window]:visible")).toHaveCount(0);
  diagnostics.expectClean();
});

test("windows stack, drag, clamp and resize", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const diagnostics = await openSite(page);
  const about = await openApp(page, "about");
  const projects = await openApp(page, "projects");
  expect(Number(await projects.evaluate((el) => el.style.zIndex))).toBeGreaterThan(
    Number(await about.evaluate((el) => el.style.zIndex))
  );
  await about.locator(".title-bar").click();
  expect(Number(await about.evaluate((el) => el.style.zIndex))).toBeGreaterThan(
    Number(await projects.evaluate((el) => el.style.zIndex))
  );

  // Drag the About title bar far off the right edge: the title bar stays visible.
  const title = await about.locator(".title-bar").boundingBox();
  await page.mouse.move(title.x + 40, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 2000, title.y + 1500, { steps: 8 });
  await page.mouse.up();
  await expectWindowReachable(page, about);

  // Corner-resize Projects: the window shrinks and switches to the narrow layout.
  // Raise it first (through the API, since the dragged About window may now
  // cover its title bar) so nothing sits over its corner.
  await page.evaluate(() => window.win98SiteKit.openWindow("projects"));
  const before = await projects.boundingBox();
  await page.mouse.move(before.x + before.width - 6, before.y + before.height - 6);
  await page.mouse.down();
  await page.mouse.move(before.x + 300, before.y + 240, { steps: 6 });
  await page.mouse.up();
  const after = await projects.boundingBox();
  expect(after.width).toBeLessThan(before.width);
  await expect(projects).toHaveClass(/is-window-narrow/);

  // Maximize fills the viewport above the taskbar; a second click restores.
  await projects.locator('[data-window-control="maximize"]').click();
  const maximized = await projects.boundingBox();
  const taskbar = await page.locator(".taskbar").boundingBox();
  expect(maximized.width).toBeGreaterThan(VIEWPORTS.desktop.width - 40);
  expect(maximized.y + maximized.height).toBeLessThanOrEqual(taskbar.y + 1);
  await projects.locator('[data-window-control="maximize"]').click();
  const restored = await projects.boundingBox();
  expect(Math.round(restored.width)).toBe(Math.round(after.width));
  diagnostics.expectClean();
});

test("selector tabs switch panels and carousels navigate", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.wide);
  const diagnostics = await openSite(page);
  const projects = await openApp(page, "projects");
  const counter = projects.locator('.viewer-content[data-view="project-one"] .gallery-counter');
  await expect(counter).toHaveText("1 of 2");
  await projects.locator('.viewer-content[data-view="project-one"] [data-carousel-next]').click();
  await expect(counter).toHaveText("2 of 2");
  await projects.locator('.viewer-content[data-view="project-one"] [data-carousel-next]').click();
  await expect(counter).toHaveText("1 of 2");
  await projects.locator('.selector-item[data-view="project-two"]').click();
  await expect(projects.locator('.viewer-content[data-view="project-two"]')).toBeVisible();
  await expect(projects.locator('.viewer-content[data-view="project-one"]')).toBeHidden();
  const image = projects.locator('.viewer-content[data-view="project-two"] .gallery-scroll > img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  diagnostics.expectClean();
});

test("the calendar opens from the clock, navigates months and shows a photo day", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.clock.install({ time: new Date("2026-10-18T14:30:00") });
  const diagnostics = await openSite(page);
  await page.click("#taskbar-clock-button");
  const popout = page.locator("#calendar-popout");
  await expect(popout).toBeVisible();
  await expect(popout.locator("#calendar-header")).toHaveText("October 2026");
  await expect(popout.locator(".calendar-day.is-today")).toHaveText("18");
  const halloween = popout.locator('[data-calendar-photo="2026-10-31"]');
  await expect(halloween).toHaveClass(/is-event-day/);
  await halloween.click();
  const alert = page.locator('[data-app-window="calendar-photo"]');
  await expect(alert).toBeVisible();
  await expect(alert.locator(".title-bar-text")).toHaveText("Halloween");
  await alert.getByRole("button", { name: "OK" }).click();
  await expect(alert).toBeHidden();
  await popout.locator("#calendar-next").click();
  await expect(popout.locator("#calendar-header")).toHaveText("November 2026");
  await popout.locator("#calendar-header").click();
  await expect(popout.locator("#calendar-header")).toHaveText("October 2026");
  await page.keyboard.press("Escape");
  await expect(popout).toBeHidden();
  diagnostics.expectClean();
});

test("Display Properties persists a wallpaper choice across reloads", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.tablet);
  const diagnostics = await openSite(page);
  const readBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  const initial = await readBackground();
  expect(initial).toContain("background-2200.jpg");
  await openApp(page, "display-properties");
  await page.locator('.display-choice:has-text("Blue sky")').click();
  expect(await readBackground()).toContain("mountain-and-sky.png");
  await page.reload();
  await page.waitForSelector("html.is-desktop-ready");
  expect(await readBackground()).toContain("mountain-and-sky.png");
  await openApp(page, "display-properties");
  await page.locator("[data-display-reset]").click();
  expect(await readBackground()).toContain("background-2200.jpg");
  diagnostics.expectClean();
});

test("deep links, Escape and the Start button", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  const diagnostics = await openSite(page, { hash: "#socials" });
  const socials = page.locator('[data-app-window="socials"]');
  await expect(socials).toBeVisible();
  await expectWindowReachable(page, socials);
  await page.keyboard.press("Escape");
  await expect(socials).toBeHidden();
  await openApp(page, "about");
  await openApp(page, "credits");
  await page.click(".start-button");
  await expect(page.locator("[data-app-window]:visible")).toHaveCount(0);
  diagnostics.expectClean();
});

test("a boot error is surfaced instead of a blank page", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.route("**/site.config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'export default { desktop: ["does-not-exist"] };' })
  );
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/showcase/index.html");
  await expect(page.locator(".boot-error")).toContainText('desktop names unknown app "does-not-exist"');
  expect(errors.some((text) => text.includes("boot failed"))).toBe(true);
});
