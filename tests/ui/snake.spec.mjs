// Snake package UI: the window fits at every viewport, the loading bar
// finishes, keys start and steer the game, the board and score update, the
// rules window opens, and the high score lands in localStorage.

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const LOADING_TIMEOUT_MS = 8000;

const snapshot = (page) => page.evaluate(() => window.win98SiteKitSnake.snapshot());

const waitForLoaded = (page) =>
  page.waitForFunction(() => !window.win98SiteKitSnake.snapshot().loading, null, { timeout: LOADING_TIMEOUT_MS });

const boardImage = (page) => page.evaluate(() => document.querySelector("#snake-canvas").toDataURL());

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const KEY_FOR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

/**
 * Steers the snake towards the apple with the arrow keys (vertical first,
 * then horizontal, never reversing) until it scores or the game ends.
 */
const steerToApple = async (page, timeoutMs = 20_000) => {
  const startedAt = Date.now();
  let snap = await snapshot(page);
  while (Date.now() - startedAt < timeoutMs && snap.score === 0 && !snap.gameOver) {
    const head = snap.snake[0];
    const apple = snap.apples[0];
    const heading = snap.directionQueue.at(-1) || snap.direction;
    const wants = [];
    if (apple.y < head.y) wants.push("up");
    else if (apple.y > head.y) wants.push("down");
    if (apple.x < head.x) wants.push("left");
    else if (apple.x > head.x) wants.push("right");
    const pick = wants.find((direction) => direction !== heading && direction !== OPPOSITE[heading]);
    if (pick) await page.keyboard.press(KEY_FOR[pick]);
    await page.waitForTimeout(60);
    snap = await snapshot(page);
  }
  return snap;
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`snake window fits the ${name} viewport and plays`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const site = await openSite(page);
    const win = await openApp(page, "snake");
    await expectWindowReachable(page, win);
    await expect(win).toHaveClass(/is-snake-loading/);
    await expect(win.locator("#snake-loading-panel")).toBeVisible();
    await waitForLoaded(page);
    await expect(win).not.toHaveClass(/is-snake-loading/);
    await expect(win.locator("#snake-status")).toHaveText("Ready");
    const body = win.locator(".window-body");
    const scroll = await body.evaluate((el) => ({ x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight }));
    expect(scroll.x, "no horizontal scrolling inside the window").toBeLessThanOrEqual(0);
    expect(scroll.y, "no vertical scrolling inside the window").toBeLessThanOrEqual(0);
    await expectWindowReachable(page, win);

    const before = await boardImage(page);
    await page.keyboard.press("ArrowUp");
    await expect(win.locator("#snake-status")).toHaveText("Starting");
    await expect(win.locator("#snake-start")).toHaveText("Pause");
    await page.waitForFunction(() => window.win98SiteKitSnake.snapshot().running, null, { timeout: 4000 });
    await expect(win.locator("#snake-status")).toHaveText("Tracking");
    await page.waitForFunction(() => window.win98SiteKitSnake.snapshot().snake[0].y < 8, null, { timeout: 4000 });
    const moved = await snapshot(page);
    expect(moved.direction).toBe("up");
    expect(await boardImage(page)).not.toBe(before);

    await page.keyboard.press(" ");
    await expect(win.locator("#snake-status")).toHaveText("Paused - press Start");
    expect((await snapshot(page)).running).toBe(false);
    site.expectClean();
  });
}

test("eating an apple scores, grows the snake and stores the high score", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "snake");
  await waitForLoaded(page);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => window.win98SiteKitSnake.snapshot().running, null, { timeout: 4000 });
  const snap = await steerToApple(page);
  expect(snap.gameOver, "the greedy path should reach the apple before any wall").toBe(false);
  expect(snap.score).toBe(1);
  expect(snap.snake.length).toBe(4);
  await expect(win.locator("#snake-score")).toHaveText("1");
  await expect(win.locator("#snake-high-score")).toHaveText("1");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("win98SiteKit.snake.highScores")))
    .toBe(JSON.stringify({ 16: 1 }));
  site.expectClean();
});

test("WASD keys steer, walls end the game and Enter resets it", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const site = await openSite(page);
  const win = await openApp(page, "snake");
  await waitForLoaded(page);
  await win.locator('[data-snake-board-size="10"]').click();
  expect((await snapshot(page)).gridSize).toBe(10);
  await expect(win.locator('[data-snake-board-size="10"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("w");
  await page.waitForFunction(() => window.win98SiteKitSnake.snapshot().gameOver, null, { timeout: 8000 });
  await expect(win.locator("#snake-status")).toHaveText("Signal lost");
  const lost = await snapshot(page);
  expect(lost.snake[0]).toEqual({ x: 5, y: 0 });
  await page.keyboard.press("Enter");
  await expect(win.locator("#snake-status")).toHaveText("Ready");
  expect((await snapshot(page)).snake[0]).toEqual({ x: 5, y: 5 });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("win98SiteKit.snake.settings")).gridSize))
    .toBe(10);
  site.expectClean();
});

test("touch pad starts the game, clicking outside pauses it, and the rules window opens", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.tablet);
  const site = await openSite(page);
  const win = await openApp(page, "snake");
  await waitForLoaded(page);
  await win.locator('[data-snake-direction="down"]').click();
  await page.waitForFunction(() => window.win98SiteKitSnake.snapshot().running, null, { timeout: 4000 });
  await expect(win.locator("#snake-status")).toHaveText("Tracking");
  await page.mouse.click(VIEWPORTS.tablet.width - 20, 20);
  await expect(win.locator("#snake-status")).toHaveText("Paused - press Start");
  // The pausing click suppresses in-window clicks for 250ms so it cannot
  // also press a control; wait that out before using the panel again.
  await page.waitForTimeout(300);
  await win.locator("#snake-help").click();
  const rules = page.locator('[data-app-window="snake-rules"]');
  await expect(rules).toBeVisible();
  await expectWindowReachable(page, rules);
  await expect(rules.locator(".snake-rules-title")).toHaveText("Snake Controls");
  await rules.locator('[data-window-control="close"]').click();
  await expect(rules).toBeHidden();
  await win.locator('[data-window-control="close"]').click();
  await expect(win).toBeHidden();
  site.expectClean();
});
