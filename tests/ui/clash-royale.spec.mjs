// Clash Royale Stats window: renders a stubbed proxy snapshot at the four
// viewports, refreshes, shows the mode hint, reports proxy errors, and falls
// back to the setup notice when config.js names no proxy.
//
// Run against the scratch site: UI_TEST_SITE=tmp/clash-royale-site npx playwright test tests/ui/clash-royale.spec.mjs

import { expect, test } from "@playwright/test";
import { VIEWPORTS, expectWindowReachable, openApp, openSite } from "./helpers.mjs";

const PROXY_BASE_URL = "https://clash-royale-proxy.test";
const PROXY_STORAGE_KEY = "win98SiteKit.clash-royale.proxyBaseUrl";
const SNAPSHOT_URL = `${PROXY_BASE_URL}/clash-royale?tag=2PP`;
const CARD_ART = /^https:\/\/api-assets\.clashroyale\.com\/.*\.png$/;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const card = (id, name, extra = {}) => ({
  id,
  name,
  elixirCost: 3,
  rarity: "rare",
  iconUrl: `https://api-assets.clashroyale.com/cards/300/${id}.png`,
  ...extra,
});

const battle = (index, playerCrowns, opponentCrowns, extra = {}) => ({
  battleTime: new Date(Date.UTC(2026, 9, 1, 12, 15) - index * 3_600_000).toISOString(),
  type: "PvP",
  gameMode: { id: 72000006, name: "Ladder_CrownRush" },
  team: [
    {
      tag: "#2PP",
      name: "Kit Tester",
      crowns: playerCrowns,
      trophyChange: playerCrowns > opponentCrowns ? 30 : -30,
      cards: [card(1, "Knight"), card(2, "Archers")],
    },
  ],
  opponent: [{ tag: `#RIVAL${index}`, name: `Opponent ${index + 1}`, crowns: opponentCrowns, cards: [card(9, "Giant")] }],
  ...extra,
});

const snapshot = (fetchedAt = "2026-10-01T12:34:56.000Z") => ({
  ok: true,
  fetchedAt,
  cacheTtlSeconds: 300,
  player: {
    tag: "#2PP",
    name: "Kit Tester",
    trophies: 8123,
    bestTrophies: 8301,
    wins: 1400,
    losses: 600,
    battleCount: 2380,
    threeCrownWins: 401,
    clan: { tag: "#CLAN", name: "Royal Friends" },
    arena: { id: 54000024, name: "Legendary Arena" },
    currentDeck: [
      card(1, "Lumberjack", {
        elixirCost: 4,
        rarity: "legendary",
        variant: "evo",
        variantIconUrl: "https://api-assets.clashroyale.com/cardevolutions/300/1.png",
      }),
      card(2, "Tombstone", { variant: "hero", variantIconUrl: "https://api-assets.clashroyale.com/cardheroes/300/2.png" }),
      card(3, "Baby Dragon", { elixirCost: 4, rarity: "epic" }),
      card(4, "Minions", { rarity: "common" }),
      card(5, "Lava Hound", { elixirCost: 7, rarity: "legendary" }),
      card(6, "Barbarian Barrel", { elixirCost: 2, rarity: "epic" }),
      card(7, "Poison", { elixirCost: 4, rarity: "epic" }),
      card(8, "Inferno Dragon", { elixirCost: 4, rarity: "legendary" }),
    ],
  },
  battles: [
    battle(0, 2, 1),
    battle(1, 0, 3, { type: "pathOfLegend", gameMode: { id: 72000464, name: "Ranked1v1_NewArena2" } }),
    battle(2, 1, 1, { type: "riverRacePvP", gameMode: { id: 72000098, name: "ClanWar_1v1" } }),
  ],
});

/** Stubs the proxy and the card art; returns the proxy call counter. */
const stubProxy = async (page, respond = (route) => route.fulfill({ json: snapshot() })) => {
  const calls = [];
  await page.route(CARD_ART, (route) => route.fulfill({ body: ONE_PIXEL_PNG, contentType: "image/png" }));
  await page.route(SNAPSHOT_URL, (route) => {
    calls.push(route.request().url());
    return respond(route, calls.length);
  });
  return calls;
};

const configureProxy = (page) =>
  page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [PROXY_STORAGE_KEY, PROXY_BASE_URL]
  );

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`renders the stubbed player at ${name} (${viewport.width}x${viewport.height}) and refreshes`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await configureProxy(page);
    const calls = await stubProxy(page, (route, count) =>
      route.fulfill({ json: snapshot(count === 1 ? "2026-10-01T12:34:56.000Z" : "2026-10-01T12:40:00.000Z") })
    );
    const site = await openSite(page);
    const win = await openApp(page, "clash-royale");
    await expectWindowReachable(page, win);

    const status = win.locator("#cr-status");
    await expect(status).toHaveText("Player data loaded with 3 recent battles.");
    await expect(status).toHaveAttribute("data-state", "success");
    expect(calls).toEqual([SNAPSHOT_URL]);

    await expect(win.locator("#cr-player-name")).toHaveText("Kit Tester");
    await expect(win.locator("#cr-player-tag")).toHaveText("#2PP");
    await expect(win.locator("#cr-profile-link")).toHaveAttribute("href", "https://royaleapi.com/player/2PP");
    await expect(win.locator("#cr-trophies .visually-hidden")).toHaveText("8,123");
    await expect(win.locator("#cr-trophies .cr-digit-image")).toHaveCount(4);
    await expect(win.locator("#cr-best-trophies .visually-hidden")).toHaveText("8,301");
    await expect(win.locator("#cr-arena")).toHaveText("Legendary Arena");
    await expect(win.locator("#cr-clan")).toHaveText("Royal Friends (#CLAN)");
    await expect(win.locator("#cr-career-record")).toHaveText("1,400 wins · 600 losses");
    await expect(win.locator("#cr-career-win-rate")).toHaveText("70.0%");
    await expect(win.locator("#cr-three-crown-wins .visually-hidden")).toHaveText("401");
    await expect(win.locator("#cr-last-updated")).toHaveAttribute("datetime", "2026-10-01T12:34:56.000Z");

    const deck = win.locator("#cr-current-deck .cr-deck-card");
    await expect(deck).toHaveCount(8);
    await expect(deck.first()).toHaveClass(/is-variant-evo/);
    await expect(deck.first().locator(".cr-deck-card-image")).toHaveAttribute(
      "src",
      "https://api-assets.clashroyale.com/cardevolutions/300/1.png"
    );
    await expect(deck.nth(1).locator(".cr-card-variant")).toHaveText("HERO");
    await expect(deck.nth(2).locator(".cr-deck-card-name")).toHaveText("Baby Dragon");
    await expect(win.locator("#cr-deck-average")).toContainText("Average Elixir: 3.9");

    const battles = win.locator("#cr-battle-log .cr-battle-item");
    await expect(battles).toHaveCount(3);
    await expect(battles.nth(0).locator(".cr-result")).toHaveText("WIN");
    await expect(battles.nth(1).locator(".cr-result")).toHaveText("LOSS");
    await expect(battles.nth(2).locator(".cr-result")).toHaveText("DRAW");
    await expect(battles.nth(0).locator(".cr-battle-mode")).toHaveText("Ladder");
    await expect(battles.nth(1).locator(".cr-battle-mode")).toHaveText("Ranked");
    await expect(battles.nth(2).locator(".cr-battle-mode")).toHaveText("Clan War");
    await expect(battles.nth(0).locator(".cr-battle-opponent")).toHaveText("Kit Tester vs. Opponent 1");
    await expect(battles.nth(0).locator(".cr-battle-metric .visually-hidden").first()).toHaveText("2 to 1 crowns");
    await expect(win.locator("#cr-sample-summary")).toHaveText("1W–1L–1D · -2 crowns");
    await expect(win.locator("#cr-history-footer")).toContainText("Most recent 3 battles loaded.");

    // Result and mode badges share one 26px height.
    const resultBox = await battles.nth(0).locator(".cr-result").boundingBox();
    const modeBox = await battles.nth(0).locator(".cr-battle-mode").boundingBox();
    expect(Math.round(resultBox.height)).toBe(26);
    expect(Math.round(modeBox.height)).toBe(26);

    // Participant art stays deferred until the disclosure opens.
    const disclosure = battles.nth(0).locator(".cr-battle-disclosure");
    await expect(disclosure.locator("img[data-cr-card-src]")).toHaveCount(3);
    await disclosure.locator("summary").click();
    await expect(disclosure.locator("img[data-cr-card-src]")).toHaveCount(0);
    await expect(disclosure.locator(".cr-deck-card--compact")).toHaveCount(3);

    // Refresh re-requests and re-renders.
    await win.locator("#cr-refresh").click();
    await expect(status).toHaveText("Player data loaded with 3 recent battles.");
    expect(calls).toEqual([SNAPSHOT_URL, SNAPSHOT_URL]);
    await expect(win.locator("#cr-last-updated")).toHaveAttribute("datetime", "2026-10-01T12:40:00.000Z");
    await expect(win.locator("#cr-refresh")).toBeEnabled();
    await expectWindowReachable(page, win);
    site.expectClean();
  });
}

test("mode badges show the raw game mode on focus and Escape dismisses the hint first", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await configureProxy(page);
  await stubProxy(page);
  const site = await openSite(page);
  const win = await openApp(page, "clash-royale");
  const badge = win.locator("#cr-battle-log .cr-battle-mode").first();
  await expect(badge).toHaveAttribute("aria-label", "Ladder mode: Ladder_CrownRush");
  await badge.focus();
  const hint = page.locator("#cr-mode-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("Ladder_CrownRush");
  await expect(badge).toHaveAttribute("aria-describedby", "cr-mode-hint");
  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();
  await expect(win).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(win).toBeHidden();
  site.expectClean();
});

test("reports a proxy failure and recovers on refresh", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await configureProxy(page);
  await stubProxy(page, (route, count) =>
    count === 1
      ? route.fulfill({ status: 503, json: { ok: false, error: "no key", code: "CLASH_ROYALE_NOT_CONFIGURED" } })
      : route.fulfill({ json: snapshot() })
  );
  const site = await openSite(page);
  const win = await openApp(page, "clash-royale");
  const status = win.locator("#cr-status");
  await expect(status).toHaveText("Player data is temporarily unavailable. Try again later.");
  await expect(status).toHaveAttribute("data-state", "error");
  await expect(win.locator("#cr-player-name")).toHaveText("Player data has not loaded.");
  await win.locator("#cr-refresh").click();
  await expect(status).toHaveAttribute("data-state", "success");
  await expect(win.locator("#cr-player-name")).toHaveText("Kit Tester");
  // The stubbed 503 is the only problem allowed: the response itself and the
  // browser's own "Failed to load resource" console line for it.
  expect(site.problems.filter((problem) => !problem.includes("503"))).toEqual([]);
  expect(site.problems).toContain(`HTTP 503: ${SNAPSHOT_URL}`);
});

test("shows the setup notice and makes no request when no proxy is configured", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  const calls = await stubProxy(page);
  const external = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1")) external.push(request.url());
  });
  const site = await openSite(page);
  const win = await openApp(page, "clash-royale");
  await expectWindowReachable(page, win);
  await expect(win.locator("#cr-setup")).toBeVisible();
  await expect(win.locator("#cr-setup")).toContainText("developer.clashroyale.com");
  await expect(win.locator("#cr-setup")).toContainText("apps/clash-royale/config.js");
  await expect(win.locator(".cr-panel")).toHaveCount(3);
  await expect(win.locator(".cr-panel").first()).toBeHidden();
  await expect(win.locator("#cr-refresh")).toBeDisabled();
  expect(calls).toEqual([]);
  expect(external).toEqual([]);
  await page.setViewportSize(VIEWPORTS.mobile);
  await expectWindowReachable(page, win);
  site.expectClean();
});
