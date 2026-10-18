// Counter package: the window opens cleanly at every viewport, and one real
// session (add a player, change totals, reset, initiative, width buttons,
// reload) works without console errors or failed requests.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const totalOf = (win, index) => win.locator(".counter-player").nth(index).locator(".counter-total");

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`counter window is reachable at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { expectClean } = await openSite(page);
    const win = await openApp(page, "counter");
    await expectWindowReachable(page, win);
    await expect(win.locator(".counter-player")).toHaveCount(1);
    await expect(win.locator(".counter-digit")).toHaveCount(5);
    await expect(win.locator('.title-bar-controls button[aria-label="Decrease Counter width"]')).toBeVisible();
    await expect(win.locator('.title-bar-controls button[aria-label="Increase Counter width"]')).toBeVisible();
    expectClean();
  });
}

test("players, totals, reset and initiative work and persist across reloads", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const { expectClean } = await openSite(page);
  const win = await openApp(page, "counter");

  await win.getByRole("button", { name: "Add Player" }).click();
  await expect(win.locator(".counter-player")).toHaveCount(2);
  await expect(win.locator(".counter-name").nth(1)).toHaveValue("Player 2");

  const first = win.locator(".counter-player").first();
  await first.getByRole("button", { name: "Add selected value" }).click();
  await expect(totalOf(win, 0)).toHaveAttribute("aria-label", "21");
  await first.getByRole("button", { name: "Select 25" }).click();
  await first.getByRole("button", { name: "Subtract selected value" }).click();
  await expect(totalOf(win, 0)).toHaveAttribute("aria-label", "-4");
  await expect(first.locator(".counter-digit").first()).toHaveAttribute("src", /digital_minus\.png$/);

  const second = win.locator(".counter-player").nth(1);
  const submit = second.locator(".counter-submit");
  await expect(submit).toBeDisabled();
  await second.locator(".counter-value-input").fill("0");
  await expect(submit).toBeDisabled();
  await second.locator(".counter-value-input").fill("123");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(totalOf(win, 1)).toHaveAttribute("aria-label", "123");

  await win.getByRole("button", { name: "Reset to 20" }).click();
  await expect(totalOf(win, 0)).toHaveAttribute("aria-label", "20");
  await expect(totalOf(win, 1)).toHaveAttribute("aria-label", "20");

  const toggle = win.locator("[data-counter-initiative-toggle]");
  const rollAll = win.locator("[data-counter-roll-all]");
  await expect(rollAll).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveText("Hide Initiative");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rollAll).toBeVisible();
  await expect(win.locator(".counter-initiative-grid")).toHaveCount(2);

  await first.getByRole("button", { name: "Set initiative to 12" }).click();
  await expect(first.locator(".counter-initiative-grid button.is-selected")).toHaveText("12");

  await rollAll.click();
  await expect(win.locator(".counter-initiative-roll:disabled")).toHaveCount(2);
  await expect(win.locator(".counter-initiative-roll:disabled")).toHaveCount(0, { timeout: 10_000 });
  await expect(win.locator(".counter-initiative-grid button.is-selected")).toHaveCount(2);
  await expect(win.locator(".counter-player.is-initiative-leader")).not.toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveText("Show Initiative");
  await expect(rollAll).toBeHidden();
  await expect(win.locator(".counter-initiative-grid")).toHaveCount(0);

  await second.getByRole("button", { name: "Delete Player 2" }).click();
  await expect(win.locator(".counter-player")).toHaveCount(1);

  await page.reload();
  await page.waitForSelector("html.is-desktop-ready");
  const reopened = await openApp(page, "counter");
  await expect(reopened.locator(".counter-player")).toHaveCount(1);
  await expect(reopened.locator(".counter-name")).toHaveValue("Player 1");
  await expect(reopened.locator("[data-counter-initiative-toggle]")).toHaveText("Show Initiative");
  expectClean();
});

test("title-bar width buttons add and remove player columns", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.wide);
  const { expectClean } = await openSite(page);
  const win = await openApp(page, "counter");
  const increase = win.locator('button[aria-label="Increase Counter width"]');
  const decrease = win.locator('button[aria-label="Decrease Counter width"]');
  const width = async () => Math.round((await win.boundingBox()).width);

  expect(await width()).toBe(448);
  await decrease.click();
  expect(await width()).toBe(254);
  await expect(decrease).toBeDisabled();
  await increase.click();
  await increase.click();
  expect(await width()).toBe(648);
  await expectWindowReachable(page, win);

  await page.reload();
  await page.waitForSelector("html.is-desktop-ready");
  const reopened = await openApp(page, "counter");
  expect(Math.round((await reopened.boundingBox()).width)).toBe(648);
  expectClean();
});
