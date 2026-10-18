// Sudoku package: the window opens and fits at every viewport, a generated
// puzzle loads, the keypad enters a digit, and pause hides the board.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`sudoku plays at ${name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const site = await openSite(page);
    const win = await openApp(page, "sudoku");
    await expectWindowReachable(page, win);

    // The loader holds until the worker has carved a puzzle, then offers Play.
    const play = win.locator("#sudoku-play");
    await expect(play).toBeEnabled({ timeout: 20_000 });
    await play.click();
    const app = win.locator(".sudoku-app");
    await expect(app).toHaveClass(/is-sudoku-playing/);
    await expect(win.locator("#sudoku-status")).toHaveText("Ready");
    await expect(win.locator(".sudoku-cell.is-given")).not.toHaveCount(0);
    await expectWindowReachable(page, win);

    // Enter a digit into an empty cell through the keypad.
    const cell = win.locator(".sudoku-cell:not(.is-given)").first();
    await cell.click();
    await expect(cell).toHaveClass(/is-selected/);
    const digitButton = win.locator('[data-sudoku-number]:not([data-sudoku-number="clear"]):not([disabled])').first();
    const digit = (await digitButton.locator(".sudoku-number-digit").textContent()).trim();
    await digitButton.click();
    await expect(cell).toHaveClass(/has-value/);
    await expect(cell.locator(".sudoku-cell-value")).toHaveText(digit);
    await expect(win.locator("#sudoku-undo")).toBeEnabled();

    // Pause hides every value and stops the clock; resume brings it back.
    await win.locator("#sudoku-pause").click();
    await expect(app).toHaveClass(/is-sudoku-paused/);
    await expect(win.locator("#sudoku-status")).toHaveText("Paused");
    await expect(cell.locator(".sudoku-cell-value")).toBeHidden();
    const resume = win.locator("#sudoku-resume");
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(app).not.toHaveClass(/is-sudoku-paused/);
    await expect(win.locator("#sudoku-status")).toHaveText("Ready");
    await expect(cell.locator(".sudoku-cell-value")).toBeVisible();

    site.expectClean();
  });
}
