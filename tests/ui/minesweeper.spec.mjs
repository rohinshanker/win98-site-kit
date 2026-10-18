// Minesweeper package UI: the window opens and stays reachable at every
// viewport, a click reveals cells and starts the timer, right-click and the
// S/D/F keys mark the hovered cell, mobile mode shows the mark buttons, and
// the Help button opens the Keyboard Controls dialog.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";
import { newBoard } from "../../registry/games/minesweeper/apps/minesweeper/rules.js";

const prepare = async (page, viewport) => {
  await page.setViewportSize(viewport);
  const site = await openSite(page);
  const win = await openApp(page, "minesweeper");
  return { site, win };
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`opens, reveals a cell and shows the controls window at ${name}`, async ({ page }) => {
    const { site, win } = await prepare(page, viewport);
    await expectWindowReachable(page, win);
    await expect(win.locator(".ms-cell")).toHaveCount(81);
    await expect(win.locator("#ms-best")).toHaveText("Best Beginner: —");

    const centre = win.locator(".ms-cell").nth(40);
    await centre.click();
    await expect(centre).toHaveClass(/is-revealed/);
    const revealed = await win.locator(".ms-cell.is-revealed").count();
    expect(revealed).toBeGreaterThanOrEqual(9);
    await expect(win.locator("#ms-reset")).toHaveAttribute("data-face", "smile");

    await win.getByRole("button", { name: "Help" }).click();
    const controls = page.locator('[data-app-window="minesweeper-controls"]');
    await expect(controls).toBeVisible();
    await expect(controls).toHaveAccessibleName("Keyboard Controls");
    await expect(controls.getByText("Press F to flag the current square.")).toBeVisible();
    await expect(controls.getByRole("button", { name: "Minesweeper Wikipedia" })).toBeFocused();
    await expectWindowReachable(page, controls);
    await page.keyboard.press("Escape");
    await expect(controls).toBeHidden();
    await expect(win.getByRole("button", { name: "Help" })).toBeFocused();

    const box = await win.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    site.expectClean();
  });
}

test("right-click cycles marks and the mine counter follows", async ({ page }) => {
  const { site, win } = await prepare(page, VIEWPORTS.desktop);
  const cell = win.locator(".ms-cell").nth(0);
  const digits = () => win.locator("#ms-mines img").evaluateAll((imgs) => imgs.map((img) => img.alt).join(""));
  expect(await digits()).toBe("010");
  await cell.click({ button: "right" });
  await expect(cell).toHaveClass(/is-flagged/);
  expect(await digits()).toBe("009");
  await cell.click({ button: "right" });
  await expect(cell).toHaveClass(/is-question/);
  expect(await digits()).toBe("010");
  await cell.click({ button: "right" });
  await expect(cell).not.toHaveClass(/is-flagged|is-question/);
  site.expectClean();
});

test("S, D and F act on the hovered cell only in keyboard mode", async ({ page }) => {
  const { site, win } = await prepare(page, VIEWPORTS.wide);
  const cells = win.locator(".ms-cell");
  await cells.nth(10).hover();
  await page.keyboard.press("f");
  await expect(cells.nth(10)).toHaveClass(/is-flagged/);
  await page.keyboard.press("f");
  await expect(cells.nth(10)).not.toHaveClass(/is-flagged/);
  await page.keyboard.press("d");
  await expect(cells.nth(10)).toHaveClass(/is-question/);
  await cells.nth(40).hover();
  await page.keyboard.press("s");
  await expect(cells.nth(40)).toHaveClass(/is-revealed/);
  // A zero cell cascades and may sweep the questioned cell; a numbered cell
  // reveals only itself, so the question mark must survive.
  if ((await cells.nth(40).getAttribute("data-number")) !== null) {
    await expect(cells.nth(10)).toHaveClass(/is-question/);
  }

  await win.locator("#ms-controls-mode").selectOption("mouse");
  await expect(win.locator("#ms-grid")).not.toHaveAttribute("aria-keyshortcuts", /.+/);
  const covered = win.locator(".ms-cell:not(.is-revealed):not(.is-question)").first();
  await covered.hover();
  await page.keyboard.press("f");
  await expect(covered).not.toHaveClass(/is-flagged/);
  site.expectClean();
});

test("mobile mode shows the mark buttons and flags on tap", async ({ page }) => {
  const { site, win } = await prepare(page, VIEWPORTS.mobile);
  const flagMode = win.locator("#ms-flag-mode");
  await expect(flagMode).toBeHidden();
  await win.locator("#ms-controls-mode").selectOption("mobile");
  await expect(flagMode).toBeVisible();
  await expect(win.locator("#ms-question-mode")).toBeVisible();
  await flagMode.click();
  await expect(flagMode).toHaveAttribute("aria-pressed", "true");
  const cell = win.locator(".ms-cell").nth(5);
  await cell.click();
  await expect(cell).toHaveClass(/is-flagged/);
  await expect(cell).not.toHaveClass(/is-revealed/);
  await win.locator("#ms-controls-mode").selectOption("keyboard");
  await expect(flagMode).toBeHidden();
  site.expectClean();
});

test("changing difficulty rebuilds the board and the window stays reachable", async ({ page }) => {
  const { site, win } = await prepare(page, VIEWPORTS.tablet);
  await win.locator("#ms-difficulty").selectOption("expert");
  await expect(win.locator(".ms-cell")).toHaveCount(480);
  await expect(win.locator("#ms-best")).toHaveText("Best Expert: —");
  await expectWindowReachable(page, win);
  const board = win.locator(".ms-board");
  expect(await board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(board).toHaveClass(/is-overflowing/);
  await win.locator("#ms-difficulty").selectOption("intermediate");
  await expect(win.locator(".ms-cell")).toHaveCount(256);
  site.expectClean();
});

const SEEDED_RANDOM = 0.5;
const SEEDED_SEED = Math.floor(SEEDED_RANDOM * 0x1_0000_0000) >>> 0;

/** The board the page will deal for a first click on `firstCell` under the seeded Math.random. */
const predictedBoard = (difficulty, firstCell) => newBoard(difficulty, firstCell, SEEDED_SEED);

const seedRandom = (page) =>
  page.addInitScript((value) => {
    Math.random = () => value;
  }, SEEDED_RANDOM);

test("revealing every safe cell wins, drops confetti and records a best time", async ({ page }) => {
  await seedRandom(page);
  const { site, win } = await prepare(page, VIEWPORTS.desktop);
  const layout = predictedBoard("beginner", 40);
  const cells = win.locator(".ms-cell");
  await cells.nth(40).click();
  await expect(cells.nth(40)).toHaveClass(/is-revealed/);
  for (const [index, cell] of layout.cells.entries()) {
    if (cell.mine) continue;
    const target = cells.nth(index);
    if ((await target.getAttribute("class")).includes("is-revealed")) continue;
    await target.click();
    await expect(target).toHaveClass(/is-revealed/);
  }
  await expect(win.locator("#ms-reset")).toHaveAttribute("data-face", "win");
  await expect(win.locator(".ms-cell.is-flagged")).toHaveCount(10);
  await expect(win.locator("#ms-best")).toHaveText(/^New best Beginner: 00:\d\d!$/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("win98SiteKit.minesweeper.bestTimes")));
  expect(Number.isInteger(stored.beginner)).toBe(true);
  expect(await page.locator("canvas.ms-confetti").evaluate((canvas) => canvas.width > 0)).toBe(true);

  await win.locator("#ms-reset").click();
  await expect(win.locator("#ms-reset")).toHaveAttribute("data-face", "smile");
  await expect(win.locator(".ms-cell.is-revealed")).toHaveCount(0);
  await expect(win.locator("#ms-best")).toHaveText(/^Best Beginner: 00:\d\d$/);
  site.expectClean();
});

test("clicking a mine loses, shows the banner and every mine, and closing deals afresh", async ({ page }) => {
  await seedRandom(page);
  const { site, win } = await prepare(page, VIEWPORTS.desktop);
  const layout = predictedBoard("beginner", 40);
  const cells = win.locator(".ms-cell");
  await cells.nth(40).click();
  const mine = layout.cells.findIndex((cell) => cell.mine);
  const safeCovered = layout.cells.findIndex((cell, index) => !cell.mine && index !== 40 && !layout.cells[index].revealed);
  await cells.nth(safeCovered).click({ button: "right" });
  await cells.nth(mine).click();
  await expect(cells.nth(mine)).toHaveClass(/is-blown/);
  await expect(win.locator(".ms-cell.is-mine")).toHaveCount(10);
  await expect(win.locator("#ms-reset")).toHaveAttribute("data-face", "lose");
  await expect(win.locator("#ms-lose-banner")).toHaveClass(/is-visible/);
  await expect(win.locator("#ms-lose-banner img")).toHaveAttribute("src", /minesweeper-you-lose-640\.png$/);
  await cells.nth(1).hover();
  await page.keyboard.press("s");
  await expect(cells.nth(1)).not.toHaveClass(/is-pressed/);

  await win.getByRole("button", { name: "Close" }).click();
  await expect(win).toBeHidden();
  await openApp(page, "minesweeper");
  await expect(win.locator(".ms-cell.is-revealed")).toHaveCount(0);
  await expect(win.locator("#ms-lose-banner")).not.toHaveClass(/is-visible/);
  await expect(win.locator("#ms-reset")).toHaveAttribute("data-face", "smile");
  site.expectClean();
});
