// Solitaire package UI: the window fits every viewport, drawing from the
// stock moves a card onto the waste (and undo puts it back), and the help
// button opens the rules window. Runs against the showcase by default or
// the scratch site named in UI_TEST_SITE.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const TABLEAU_CARDS = 28;

/** The seven-segment counter reads as the alt text of its three digit images. */
const expectCounter = async (win, text) => {
  await expect
    .poll(() => win.locator(".sol-counter img").evaluateAll((images) => images.map((image) => image.alt).join("")))
    .toBe(text);
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`solitaire window is reachable and fully dealt at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const site = await openSite(page);
    const win = await openApp(page, "solitaire");
    await expectWindowReachable(page, win);
    await expect(win.locator(".sol-tableau-col")).toHaveCount(7);
    await expect(win.locator(".sol-tableau .sol-card")).toHaveCount(TABLEAU_CARDS);
    await expect(win.locator(".sol-tableau .sol-card:not(.is-face-down)")).toHaveCount(7);
    await expect(win.locator(".sol-stock .sol-card")).toHaveCount(1);
    await expect(win.locator(".sol-stock")).toHaveAttribute("aria-label", "Stock, 24 cards");
    const board = await win.locator(".sol-board").boundingBox();
    expect(board.x + board.width).toBeLessThanOrEqual(viewport.width + 1);
    site.expectClean();
  });
}

test("drawing from the stock moves a card to the waste and undo returns it", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "solitaire");
  const waste = win.locator(".sol-waste");
  const digits = win.locator(".sol-counter img");
  await expect(waste.locator(".sol-card")).toHaveCount(0);
  await expect(waste).toHaveAttribute("aria-label", "Waste");
  await expectCounter(win, "000");
  await expect(win.locator(".sol-undo")).toBeDisabled();

  await win.locator(".sol-stock").click();
  await expect(waste.locator(".sol-card")).toHaveCount(1);
  await expect(waste).toHaveAttribute("aria-label", /^Waste, .+ of .+$/);
  await expect(win.locator(".sol-stock")).toHaveAttribute("aria-label", "Stock, 23 cards");
  await expect(digits.nth(2)).toHaveAttribute("alt", "1");
  await expect(digits.nth(2)).toHaveAttribute("src", /digital_1\.png$/);

  await win.locator(".sol-stock").click();
  await expect(win.locator(".sol-stock")).toHaveAttribute("aria-label", "Stock, 22 cards");
  await expect(digits.nth(2)).toHaveAttribute("alt", "2");

  await waste.locator(".sol-card").click();
  await expect(waste.locator(".sol-card")).toHaveClass(/is-selected/);
  // A second click inside 500ms is the send-to-foundation double-click; a
  // later one toggles the selection off.
  await page.waitForTimeout(600);
  await waste.locator(".sol-card").click();
  await expect(waste.locator(".sol-card")).not.toHaveClass(/is-selected/);

  await expect(win.locator(".sol-undo")).toBeEnabled();
  await win.locator(".sol-undo").click();
  await win.locator(".sol-undo").click();
  await expect(waste.locator(".sol-card")).toHaveCount(0);
  await expect(win.locator(".sol-stock")).toHaveAttribute("aria-label", "Stock, 24 cards");
  await expectCounter(win, "000");
  await expect(win.locator(".sol-undo")).toBeDisabled();
  site.expectClean();
});

test("reset deals a fresh game and the help button opens the rules window", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.tablet);
  const site = await openSite(page);
  const win = await openApp(page, "solitaire");
  await win.locator(".sol-stock").click();
  await expect(win.locator(".sol-waste .sol-card")).toHaveCount(1);
  // The toolbar swaps Reset for Auto-solve whenever a card can go to a
  // foundation, so with such a deal run the auto-solve until Reset is back.
  const reset = win.locator(".sol-reset");
  const autoSolve = win.locator(".sol-auto-solve");
  for (let runs = 0; runs < 6 && !(await reset.isVisible()); runs += 1) {
    await expect(autoSolve).toBeEnabled();
    await autoSolve.click();
    await expect(autoSolve).toBeDisabled();
    await expect.poll(() => autoSolve.isDisabled(), { timeout: 30_000 }).toBe(false);
  }
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(win.locator(".sol-waste .sol-card")).toHaveCount(0);
  await expectCounter(win, "000");
  await expect(win.locator(".sol-tableau .sol-card")).toHaveCount(TABLEAU_CARDS);

  await win.locator('[data-window-control="help"]').click();
  const rulesWindow = page.locator('[data-app-window="solitaire-rules"]');
  await expect(rulesWindow).toBeVisible();
  await expect(rulesWindow).not.toHaveClass(/is-opening/);
  await expectWindowReachable(page, rulesWindow);
  await expect(rulesWindow.locator(".sol-rules-list li")).toHaveCount(12);
  await rulesWindow.locator('[data-window-control="close"]').click();
  await expect(rulesWindow).toBeHidden();
  site.expectClean();
});
