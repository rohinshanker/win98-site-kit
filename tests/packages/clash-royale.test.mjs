// Clash Royale Stats package: the pure api.js helpers, the Worker's
// response shaping and routing with a mocked fetch, and the local proxy.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASH_MAX_BATTLES,
  EMPTY_VALUE,
  buildClashSnapshotUrl,
  calculateAverageElixir,
  classifyClashBattleMode,
  errorMessageFor,
  formatClan,
  formatClashBattleMode,
  formatHistoryPrefix,
  formatLoadedStatus,
  formatMatchup,
  formatSampleSummary,
  formatWinRate,
  isValidClashTag,
  normalizeClashCardIconUrl,
  normalizeClashCardRarity,
  normalizeClashCardVariant,
  normalizeClashTag,
  normalizeProxyBaseUrl,
  parseClashBattleTime,
  participantName,
  prepareClashSnapshot,
  resolveClashBattle,
  resolveClashSettings,
  royaleApiProfileUrl,
  summarizeClashBattles,
} from "../../registry/apps/clash-royale/apps/clash-royale/api.js";
import worker, {
  HttpError,
  allowedCorsOrigin,
  corsHeaders,
  errorResponse,
  handleRequest,
  normalizeClashRoyalePayload,
  normalizeTag,
  resolveRequestedTag,
} from "../../registry/apps/clash-royale/proxy/clash-royale/worker.mjs";
import {
  createMemoryCache,
  parsePort,
  startLocalProxy,
} from "../../registry/apps/clash-royale/proxy/clash-royale/local-proxy.mjs";

// --- Fixtures ---------------------------------------------------------------

const TAG = "2PP";
const FIXED_NOW = Date.parse("2026-10-01T16:30:00.000Z");

const appCard = (id, name, extra = {}) => ({
  id,
  name,
  elixirCost: 3,
  rarity: "rare",
  iconUrl: `https://api-assets.clashroyale.com/cards/300/${id}.png`,
  ...extra,
});

const appBattle = (playerCrowns, opponentCrowns, extra = {}) => ({
  battleTime: "20261001T121500.000Z",
  type: "PvP",
  gameMode: { id: 72000006, name: "Ladder" },
  team: [{ tag: `#${TAG}`, name: "Kit Tester", crowns: playerCrowns, trophyChange: 30, cards: [appCard(1, "Knight")] }],
  opponent: [{ tag: "#RIVAL", name: "Rival", crowns: opponentCrowns, cards: [appCard(2, "Giant")] }],
  ...extra,
});

const appPayload = (overrides = {}) => ({
  ok: true,
  fetchedAt: "2026-10-01T12:34:56.000Z",
  cacheTtlSeconds: 300,
  player: {
    tag: `#${TAG}`,
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
      appCard(1, "Lumberjack", { elixirCost: 4, rarity: "legendary", variant: "evo", variantIconUrl: "https://api-assets.clashroyale.com/cardevolutions/300/1.png" }),
      appCard(2, "Tombstone"),
      appCard(3, "Baby Dragon", { elixirCost: 4 }),
      appCard(4, "Minions"),
      appCard(5, "Lava Hound", { elixirCost: 7 }),
      appCard(6, "Barbarian Barrel", { elixirCost: 2 }),
      appCard(7, "Poison", { elixirCost: 4 }),
      appCard(8, "Inferno Dragon", { elixirCost: 4 }),
    ],
  },
  battles: [appBattle(2, 1), appBattle(0, 3), appBattle(1, 1)],
  ...overrides,
});

const upstreamCard = (overrides = {}) => ({
  id: 26000000,
  name: "Knight",
  level: 14,
  maxLevel: 14,
  elixirCost: 3,
  rarity: "Common",
  iconUrls: { medium: "https://api-assets.clashroyale.com/cards/300/knight.png" },
  ...overrides,
});

const upstreamProfile = (overrides = {}) => ({
  tag: `#${TAG}`,
  name: "Kit Tester",
  trophies: 8123,
  bestTrophies: 8200,
  wins: 5000,
  losses: 4100,
  battleCount: 9200,
  threeCrownWins: 900,
  expLevel: 50,
  clan: { tag: "#2ABC", name: "Example Clan", badgeId: 16000000 },
  arena: { id: 54000012, name: "Legendary Arena" },
  currentDeck: [
    upstreamCard({
      evolutionLevel: 1,
      iconUrls: {
        medium: "https://api-assets.clashroyale.com/cards/300/knight.png",
        evolutionMedium: "https://api-assets.clashroyale.com/cardevolutions/300/knight.png",
      },
    }),
    upstreamCard({ id: 28000006, name: "Mirror", elixirCost: 1, rarity: "Epic" }),
    upstreamCard({
      id: 26000001,
      name: "Mini P.E.K.K.A",
      evolutionLevel: 2,
      iconUrls: {
        medium: "https://untrusted.example/card.png",
        heroMedium: "https://api-assets.clashroyale.com/cardheroes/300/mini-pekka.png",
      },
    }),
  ],
  leagueStatistics: { secret: "not exposed" },
  ...overrides,
});

const upstreamBattlelog = () => [
  {
    battleTime: "20261001T160000.000Z",
    type: "PvP",
    gameMode: { id: 72000006, name: "Ladder", ignored: true },
    deckSelection: "collection",
    team: [{ tag: `#${TAG}`, name: "Kit Tester", crowns: 2, trophyChange: 30, cards: [upstreamCard()] }],
    opponent: [{ tag: "#9XYZ", name: "Opponent", crowns: 1, trophyChange: -30, cards: [upstreamCard()] }],
    ignoredBattleField: "not exposed",
  },
];

const jsonUpstream = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const PLAYER_URL = `https://proxy.royaleapi.dev/v1/players/%23${TAG}`;

const mockFetch = ({ profile = upstreamProfile(), battlelog = upstreamBattlelog(), status = 200, headers = {} } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === PLAYER_URL) return jsonUpstream(profile, status, headers);
    if (url === `${PLAYER_URL}/battlelog`) return jsonUpstream(battlelog, status, headers);
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
};

const env = (overrides = {}) => ({
  CLASH_ROYALE_API_KEY: "test-token",
  PLAYER_TAG: `#${TAG}`,
  ALLOWED_ORIGINS: "https://site.example",
  ...overrides,
});

const request = (path = "/clash-royale", { origin = "https://site.example", method = "GET" } = {}) =>
  new Request(`https://proxy.example${path}`, { method, headers: origin ? { Origin: origin } : {} });

const json = async (response) => JSON.parse(await response.text());

// --- api.js -----------------------------------------------------------------

test("normalizeClashTag strips the hash, trims and upper-cases", () => {
  assert.equal(normalizeClashTag(" #2pp "), "2PP");
  assert.equal(normalizeClashTag("abc"), "ABC");
  assert.equal(normalizeClashTag(null), "");
  assert.equal(isValidClashTag("#2PP"), true);
  assert.equal(isValidClashTag("2P"), false);
  assert.equal(isValidClashTag("bad tag!"), false);
});

test("normalizeProxyBaseUrl keeps plain http(s) origins and paths only", () => {
  assert.equal(normalizeProxyBaseUrl("https://proxy.example/"), "https://proxy.example");
  assert.equal(normalizeProxyBaseUrl("http://127.0.0.1:8787/base//"), "http://127.0.0.1:8787/base");
  assert.equal(normalizeProxyBaseUrl(""), "");
  assert.equal(normalizeProxyBaseUrl("ftp://proxy.example"), "");
  assert.equal(normalizeProxyBaseUrl("https://user:pw@proxy.example"), "");
  assert.equal(normalizeProxyBaseUrl("https://proxy.example/?x=1"), "");
  assert.equal(normalizeProxyBaseUrl("https://proxy.example/#hash"), "");
  assert.equal(normalizeProxyBaseUrl("not a url"), "");
});

test("resolveClashSettings prefers overrides and drops unusable values", () => {
  const config = { playerTag: "#2PP", proxyBaseUrl: "" };
  assert.deepEqual(resolveClashSettings(config, {}), { playerTag: "2PP", proxyBaseUrl: "" });
  assert.deepEqual(resolveClashSettings(config, { playerTag: "#abc", proxyBaseUrl: "https://p.example/" }), {
    playerTag: "ABC",
    proxyBaseUrl: "https://p.example",
  });
  assert.deepEqual(resolveClashSettings({ playerTag: "!!", proxyBaseUrl: "ftp://x" }), { playerTag: "", proxyBaseUrl: "" });
  assert.deepEqual(resolveClashSettings(), { playerTag: "", proxyBaseUrl: "" });
});

test("buildClashSnapshotUrl and royaleApiProfileUrl encode the tag", () => {
  assert.equal(buildClashSnapshotUrl("https://p.example/", "#2pp"), "https://p.example/clash-royale?tag=2PP");
  assert.equal(buildClashSnapshotUrl("https://p.example", ""), "https://p.example/clash-royale");
  assert.equal(buildClashSnapshotUrl("", "2PP"), "");
  assert.equal(royaleApiProfileUrl("#2pp"), "https://royaleapi.com/player/2PP");
  assert.equal(royaleApiProfileUrl(""), "https://royaleapi.com/");
});

test("normalizeClashCardIconUrl accepts only https PNGs on the official asset host", () => {
  const good = "https://api-assets.clashroyale.com/cards/300/knight.png";
  assert.equal(normalizeClashCardIconUrl(good), good);
  assert.equal(normalizeClashCardIconUrl("http://api-assets.clashroyale.com/cards/300/knight.png"), "");
  assert.equal(normalizeClashCardIconUrl("https://evil.example/cards/300/knight.png"), "");
  assert.equal(normalizeClashCardIconUrl("https://api-assets.clashroyale.com/cards/300/knight.svg"), "");
  assert.equal(normalizeClashCardIconUrl("https://u:p@api-assets.clashroyale.com/cards/300/knight.png"), "");
  assert.equal(normalizeClashCardIconUrl("nonsense"), "");
  assert.equal(normalizeClashCardIconUrl(undefined), "");
});

test("rarity and variant normalizers accept the known values only", () => {
  assert.equal(normalizeClashCardRarity(" Legendary "), "legendary");
  assert.equal(normalizeClashCardRarity("mythic"), "");
  assert.equal(normalizeClashCardVariant("EVO"), "evo");
  assert.equal(normalizeClashCardVariant("hero"), "hero");
  assert.equal(normalizeClashCardVariant("super"), "");
});

test("calculateAverageElixir needs integer costs and no Mirror", () => {
  assert.equal(calculateAverageElixir([{ elixirCost: 3 }, { elixirCost: 4 }]), 3.5);
  assert.equal(calculateAverageElixir([]), null);
  assert.equal(calculateAverageElixir(null), null);
  assert.equal(calculateAverageElixir([{ elixirCost: 3 }, { id: 28000006 }]), null);
  assert.equal(calculateAverageElixir([{ elixirCost: 3 }, { elixirCost: undefined }]), null);
  assert.equal(calculateAverageElixir([{ elixirCost: 2.5 }]), null);
});

test("resolveClashBattle finds the player on either side and classifies the outcome", () => {
  const win = resolveClashBattle(appBattle(2, 1), "#2pp");
  assert.equal(win.outcome, "win");
  assert.equal(win.player.name, "Kit Tester");
  assert.equal(win.opponent.name, "Rival");
  assert.deepEqual(win.allies, []);
  assert.equal(resolveClashBattle(appBattle(0, 3), TAG).outcome, "loss");
  assert.equal(resolveClashBattle(appBattle(1, 1), TAG).outcome, "draw");

  const swapped = appBattle(1, 2);
  const flipped = resolveClashBattle({ ...swapped, team: swapped.opponent, opponent: swapped.team }, TAG);
  assert.equal(flipped.outcome, "loss");
  assert.equal(flipped.playerSide[0].name, "Kit Tester");

  const twoVTwo = appBattle(3, 0);
  twoVTwo.team.push({ tag: "#ALLY", name: "Ally", crowns: 3 });
  assert.deepEqual(resolveClashBattle(twoVTwo, TAG).allies.map(participantName), ["Ally"]);

  const unknown = appBattle(undefined, 1);
  assert.equal(resolveClashBattle(unknown, TAG).outcome, "unknown");
  assert.equal(resolveClashBattle(unknown, TAG).hasCrowns, false);
  assert.equal(resolveClashBattle(appBattle(1, 1), "#OTHER"), null);
  assert.equal(resolveClashBattle({ team: "no", opponent: [] }, TAG), null);
  assert.equal(resolveClashBattle(null, TAG), null);
  assert.equal(resolveClashBattle(appBattle(1, 1), ""), null);
});

test("prepareClashSnapshot validates the payload and bounds the collections", () => {
  const snapshot = prepareClashSnapshot(appPayload(), "#2pp");
  assert.equal(snapshot.playerTag, TAG);
  assert.equal(snapshot.fetchedAt.toISOString(), "2026-10-01T12:34:56.000Z");
  assert.equal(snapshot.battles.length, 3);
  assert.deepEqual(snapshot.battles.map((battle) => battle.outcome), ["win", "loss", "draw"]);
  assert.equal(snapshot.currentDeck.length, 8);

  const big = appPayload({ battles: Array.from({ length: 25 }, () => appBattle(1, 0)) });
  big.player.currentDeck = Array.from({ length: 10 }, (_, index) => appCard(index, `Card ${index}`)).concat([{ name: " " }]);
  const bounded = prepareClashSnapshot(big);
  assert.equal(bounded.battles.length, CLASH_MAX_BATTLES);
  assert.equal(bounded.currentDeck.length, 8);

  assert.throws(() => prepareClashSnapshot(appPayload(), "#OTHER"), /player tag/);
  assert.throws(() => prepareClashSnapshot(appPayload({ ok: false })), /Invalid Clash Royale response/);
  assert.throws(() => prepareClashSnapshot(null), /Invalid Clash Royale response/);
  assert.throws(() => prepareClashSnapshot(appPayload({ fetchedAt: "yesterday" })), /timestamp/);
  assert.throws(() => prepareClashSnapshot(appPayload({ fetchedAt: "2026-13-45T12:34:56Z" })), /timestamp/);
  assert.throws(() => prepareClashSnapshot(appPayload({ cacheTtlSeconds: 60 })), /cache lifetime/);
  assert.throws(() => prepareClashSnapshot(appPayload({ battles: "none" })), /collections/);
  const badTag = appPayload();
  badTag.player.tag = "!!";
  assert.throws(() => prepareClashSnapshot(badTag), /player tag/);
});

test("summarizeClashBattles and formatSampleSummary describe the sample", () => {
  const snapshot = prepareClashSnapshot(appPayload());
  const summary = summarizeClashBattles(snapshot.battles);
  assert.deepEqual(summary, { crownDifference: -2, draws: 1, known: 3, losses: 1, total: 3, wins: 1 });
  assert.equal(formatSampleSummary(summary), "1W–1L–1D · -2 crowns");
  assert.equal(formatSampleSummary({ ...summary, crownDifference: 4 }), "1W–1L–1D · +4 crowns");
  assert.equal(formatSampleSummary(summarizeClashBattles([])), "No usable battles");
  assert.equal(formatSampleSummary(summarizeClashBattles(null)), "No usable battles");
  const unknown = [resolveClashBattle(appBattle(undefined, 1), TAG)];
  assert.equal(formatSampleSummary(summarizeClashBattles(unknown)), "1 battle; results unavailable");
  assert.equal(formatSampleSummary({ total: 2, known: 0 }), "2 battles; results unavailable");
});

test("status, footer, clan and win-rate formatters", () => {
  assert.equal(formatHistoryPrefix(20), "Most recent 20 battles loaded. View ");
  assert.equal(formatHistoryPrefix(1), "Most recent 1 battle loaded. View ");
  assert.equal(formatHistoryPrefix(5), "Most recent 5 battles loaded. View ");
  assert.equal(formatHistoryPrefix(0), "No recent battles loaded. View ");
  assert.equal(formatLoadedStatus(1), "Player data loaded with 1 recent battle.");
  assert.equal(formatLoadedStatus(3), "Player data loaded with 3 recent battles.");
  assert.equal(formatLoadedStatus(0), "Player data loaded. No recent battles were returned.");
  assert.equal(formatClan({ name: "Royal Friends", tag: "#CLAN" }), "Royal Friends (#CLAN)");
  assert.equal(formatClan({ name: "Solo" }), "Solo");
  assert.equal(formatClan({ name: " " }), "No clan");
  assert.equal(formatClan(undefined), "No clan");
  assert.equal(formatWinRate(1400, 600), "70.0%");
  assert.equal(formatWinRate(0, 0), EMPTY_VALUE);
  assert.equal(formatWinRate(undefined, 5), EMPTY_VALUE);
});

test("parseClashBattleTime reads compact and ISO timestamps", () => {
  assert.equal(parseClashBattleTime("20261001T121500.000Z").toISOString(), "2026-10-01T12:15:00.000Z");
  assert.equal(parseClashBattleTime("20261001T121500Z").toISOString(), "2026-10-01T12:15:00.000Z");
  assert.equal(parseClashBattleTime("2026-10-01T12:15:00Z").toISOString(), "2026-10-01T12:15:00.000Z");
  assert.equal(parseClashBattleTime("soon"), null);
  assert.equal(parseClashBattleTime(""), null);
});

test("classifyClashBattleMode maps exact types and ids; formatClashBattleMode falls back", () => {
  const mode = (type, id) => classifyClashBattleMode({ type, gameMode: { id } }).key;
  assert.equal(mode("boatBattle", 1), "clan-war");
  assert.equal(mode("riverRaceDuelColosseum", 1), "clan-war");
  assert.equal(mode("pathOfLegend", 72000006), "ranked");
  assert.equal(mode("challenge", 72000006), "challenge");
  assert.equal(mode("PvP", 72000006), "ladder");
  assert.equal(mode("PvP", 72000007), "friendly");
  assert.equal(mode("PvP", 72000014), "two-v-two");
  assert.equal(mode("PvP", 72000268), "clan-war");
  assert.equal(mode("PvP", 72000999), "other");
  assert.equal(classifyClashBattleMode(null).label, "Other");
  assert.equal(classifyClashBattleMode({ type: "PvP", gameMode: { id: 72000006 } }).label, "Ladder");
  assert.equal(formatClashBattleMode({ gameMode: { name: "Ranked1v1" } }), "Ranked1v1");
  assert.equal(formatClashBattleMode({ type: "PvP" }), "PvP");
  assert.equal(formatClashBattleMode({}), "Battle");
});

test("participantName and formatMatchup", () => {
  assert.equal(participantName({ name: "A" }), "A");
  assert.equal(participantName({ tag: "#T" }), "#T");
  assert.equal(participantName({ name: " " }), "Unknown player");
  assert.equal(participantName(null), "Unknown player");
  assert.equal(
    formatMatchup({ playerSide: [{ name: "Me" }, { name: "Ally" }], opponents: [{ name: "X" }, { tag: "#Y" }] }),
    "Me & Ally vs. X & #Y"
  );
});

test("errorMessageFor maps proxy failures to friendly copy", () => {
  assert.equal(errorMessageFor(429, { retryAfterMs: 2500 }), "Too many refreshes. Try again in 3 seconds.");
  assert.equal(errorMessageFor(429, {}), "Too many refreshes. Try again shortly.");
  assert.match(errorMessageFor(503), /temporarily unavailable/);
  assert.match(errorMessageFor(504), /timed out/);
  assert.match(errorMessageFor(502), /returned an error/);
  assert.match(errorMessageFor(403), /PLAYER_TAG/);
  assert.equal(errorMessageFor(500), "Player data could not be loaded. Try again.");
});

// --- worker.mjs -------------------------------------------------------------

test("worker normalizeTag and resolveRequestedTag", () => {
  assert.equal(normalizeTag("#2pp"), "2PP");
  assert.equal(normalizeTag("no!"), "");
  const url = (query = "") => new URL(`https://proxy.example/clash-royale${query}`);
  assert.equal(resolveRequestedTag(url(), { PLAYER_TAG: "#2PP" }), "2PP");
  assert.equal(resolveRequestedTag(url("?tag=2pp"), { PLAYER_TAG: "#2PP" }), "2PP");
  assert.equal(resolveRequestedTag(url("?tag=%23ABC"), {}), "ABC");
  assert.throws(() => resolveRequestedTag(url("?tag=ABC"), { PLAYER_TAG: "2PP" }), (error) => error.status === 403);
  assert.throws(() => resolveRequestedTag(url(), {}), (error) => error.status === 400);
  assert.throws(() => resolveRequestedTag(url("?tag=!!"), {}), (error) => error.status === 400);
});

test("normalizeClashRoyalePayload keeps allowlisted fields and maps variants", () => {
  const payload = normalizeClashRoyalePayload(upstreamProfile(), upstreamBattlelog(), FIXED_NOW, "2pp");
  assert.equal(payload.ok, true);
  assert.equal(payload.cacheTtlSeconds, 300);
  assert.equal(payload.fetchedAt, "2026-10-01T16:30:00.000Z");
  assert.deepEqual(Object.keys(payload.player), [
    "tag", "name", "trophies", "bestTrophies", "wins", "losses", "battleCount", "threeCrownWins", "clan", "arena", "currentDeck",
  ]);
  assert.equal(payload.player.tag, "#2PP");
  const [knight, mirror, pekka] = payload.player.currentDeck;
  assert.equal(knight.variant, "evo");
  assert.equal(knight.rarity, "common");
  assert.equal(knight.variantIconUrl, "https://api-assets.clashroyale.com/cardevolutions/300/knight.png");
  assert.equal("elixirCost" in mirror, false);
  assert.equal(pekka.variant, "hero");
  assert.equal("iconUrl" in pekka, false);
  assert.equal(pekka.variantIconUrl, "https://api-assets.clashroyale.com/cardheroes/300/mini-pekka.png");
  const [battle] = payload.battles;
  assert.deepEqual(Object.keys(battle), ["battleTime", "type", "gameMode", "deckSelection", "team", "opponent"]);
  assert.deepEqual(battle.gameMode, { id: 72000006, name: "Ladder" });
  assert.equal(battle.team[0].trophyChange, 30);
  assert.equal(battle.opponent[0].trophyChange, -30);
  assert.equal("ignoredBattleField" in battle, false);
  assert.equal(JSON.stringify(payload).includes("not exposed"), false);
});

test("normalizeClashRoyalePayload rejects bad upstream data", () => {
  const throws502 = (fn) => assert.throws(fn, (error) => error instanceof HttpError && error.status === 502);
  throws502(() => normalizeClashRoyalePayload(upstreamProfile(), upstreamBattlelog(), FIXED_NOW, "OTHER"));
  throws502(() => normalizeClashRoyalePayload(null, [], FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile(), "nope", FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile({ name: "" }), upstreamBattlelog(), FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile({ currentDeck: "x" }), upstreamBattlelog(), FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile({ currentDeck: [{ name: "No id" }] }), upstreamBattlelog(), FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile({ clan: { tag: "#X", name: "Y" } }), upstreamBattlelog(), FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile(), [{ battleTime: "t", team: [], opponent: [] }], FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile(), [null], FIXED_NOW, TAG));
  throws502(() => normalizeClashRoyalePayload(upstreamProfile(), [{ battleTime: "t", team: ["x"], opponent: [] }], FIXED_NOW, TAG));
  const noDeck = normalizeClashRoyalePayload(upstreamProfile({ currentDeck: undefined, clan: undefined, arena: { id: 1 } }), [], FIXED_NOW, TAG);
  assert.deepEqual(noDeck.player.currentDeck, []);
  assert.equal("clan" in noDeck.player, false);
  assert.equal("arena" in noDeck.player, false);
});

test("CORS helpers honour ALLOWED_ORIGINS lists and the wildcard", () => {
  assert.equal(allowedCorsOrigin(request(), env()), "https://site.example");
  assert.equal(allowedCorsOrigin(request("/", { origin: "https://other.example" }), env()), "");
  assert.equal(allowedCorsOrigin(request("/", { origin: "" }), env()), "");
  assert.equal(allowedCorsOrigin(request("/", { origin: "https://any.example" }), env({ ALLOWED_ORIGINS: "*" })), "https://any.example");
  assert.equal(allowedCorsOrigin(request("/", { origin: "https://b.example" }), env({ ALLOWED_ORIGINS: " https://a.example , https://b.example/ " })), "https://b.example");
  assert.equal(allowedCorsOrigin(request("/", { origin: "garbage" }), env({ ALLOWED_ORIGINS: "*" })), "");
  assert.deepEqual(corsHeaders(request("/", { origin: "https://nope.example" }), env()), {});
  assert.equal(corsHeaders(request(), env())["Access-Control-Allow-Origin"], "https://site.example");
  assert.equal(corsHeaders(request(), env()).Vary, "Origin");
});

test("errorResponse hides unknown errors and exposes Retry-After", async () => {
  const unknown = errorResponse(request(), env(), new Error("secret details"));
  assert.equal(unknown.status, 500);
  assert.deepEqual(await json(unknown), { ok: false, error: "Internal server error" });
  const limited = errorResponse(request(), env(), new HttpError(429, "Slow down", { code: "X", retryAfterMs: 1500 }));
  assert.equal(limited.headers.get("Retry-After"), "2");
  assert.deepEqual(await json(limited), { ok: false, error: "Slow down", code: "X", retryAfterMs: 1500 });
});

test("handleRequest serves the snapshot with CORS and caches it for five minutes", async () => {
  const { calls, fetchImpl } = mockFetch();
  let clock = FIXED_NOW;
  const now = () => clock;
  const options = { fetchImpl, cache: createMemoryCache(now), now };
  const response = await handleRequest(request("/clash-royale?tag=2pp"), env(), null, options);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://site.example");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await json(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.player.name, "Kit Tester");
  assert.equal(payload.battles.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url).sort(), [PLAYER_URL, `${PLAYER_URL}/battlelog`]);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");

  const again = await handleRequest(request(), env(), null, options);
  assert.equal(again.status, 200);
  assert.equal((await json(again)).fetchedAt, payload.fetchedAt);
  assert.equal(calls.length, 2, "second request is served from the cache");

  clock += 301_000;
  await handleRequest(request(), env(), null, options);
  assert.equal(calls.length, 4, "an expired cache entry refetches");
});

test("handleRequest uses waitUntil when the platform offers it and survives a broken cache", async () => {
  const { fetchImpl } = mockFetch();
  const pending = [];
  const context = { waitUntil: (promise) => pending.push(promise) };
  const cache = createMemoryCache(() => FIXED_NOW);
  const response = await handleRequest(request(), env(), context, { fetchImpl, cache, now: () => FIXED_NOW });
  assert.equal(response.status, 200);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
  assert.ok(await cache.match("https://proxy.example/clash-royale?schema=1&tag=2PP"));

  const broken = { match: async () => { throw new Error("down"); }, put: async () => { throw new Error("down"); } };
  const fallback = await handleRequest(request(), env(), null, { fetchImpl, cache: broken, now: () => FIXED_NOW });
  assert.equal(fallback.status, 200);
  const noCache = await handleRequest(request(), env(), null, { fetchImpl, cache: null, now: () => FIXED_NOW });
  assert.equal(noCache.status, 200);
});

test("handleRequest answers preflight, routing and origin errors without touching upstream", async () => {
  const { calls, fetchImpl } = mockFetch();
  const options = { fetchImpl, cache: null };
  const preflight = await handleRequest(request("/clash-royale", { method: "OPTIONS" }), env(), null, options);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  const missing = await handleRequest(request("/other"), env(), null, options);
  assert.equal(missing.status, 404);
  const method = await handleRequest(request("/clash-royale", { method: "POST" }), env(), null, options);
  assert.equal(method.status, 405);
  const origin = await handleRequest(request("/clash-royale", { origin: "https://evil.example" }), env(), null, options);
  assert.equal(origin.status, 403);
  assert.equal(origin.headers.has("Access-Control-Allow-Origin"), false);
  const noKey = await handleRequest(request(), env({ CLASH_ROYALE_API_KEY: "" }), null, options);
  assert.equal(noKey.status, 503);
  assert.equal((await json(noKey)).code, "CLASH_ROYALE_NOT_CONFIGURED");
  const mismatch = await handleRequest(request("/clash-royale?tag=ZZZ"), env(), null, options);
  assert.equal(mismatch.status, 403);
  assert.equal((await json(mismatch)).code, "CLASH_ROYALE_TAG_MISMATCH");
  const noOrigin = await handleRequest(request("/clash-royale", { origin: "" }), env(), null, options);
  assert.equal(noOrigin.status, 200, "non-browser callers need no Origin");
  assert.equal(calls.length, 2);
});

test("handleRequest translates upstream failures", async () => {
  const run = (mock) => handleRequest(request(), env(), null, { fetchImpl: mock.fetchImpl, cache: null });
  const auth = await run(mockFetch({ status: 403 }));
  assert.equal(auth.status, 502);
  assert.equal((await json(auth)).code, "CLASH_ROYALE_UPSTREAM_AUTH");
  const notFound = await run(mockFetch({ status: 404 }));
  assert.equal((await json(notFound)).code, "CLASH_ROYALE_PLAYER_NOT_FOUND");
  const limited = await run(mockFetch({ status: 429, headers: { "Retry-After": "7" } }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "7");
  assert.equal((await json(limited)).retryAfterMs, 7000);
  const limitedNoHeader = await run(mockFetch({ status: 429 }));
  assert.equal((await json(limitedNoHeader)).retryAfterMs, 30_000);
  const outage = await run(mockFetch({ status: 500 }));
  assert.equal((await json(outage)).code, "CLASH_ROYALE_UPSTREAM_ERROR");
  const wrongPlayer = await run(mockFetch({ profile: upstreamProfile({ tag: "#OTHER" }) }));
  assert.equal((await json(wrongPlayer)).code, "CLASH_ROYALE_INVALID_DATA");

  const invalidJson = await handleRequest(request(), env(), null, {
    cache: null,
    fetchImpl: async () => new Response("<html>", { status: 200 }),
  });
  assert.equal((await json(invalidJson)).code, "CLASH_ROYALE_INVALID_DATA");
  const tooLarge = await handleRequest(request(), env(), null, {
    cache: null,
    fetchImpl: async () => new Response("{}", { status: 200, headers: { "Content-Length": String(2 * 1024 * 1024) } }),
  });
  assert.equal((await json(tooLarge)).code, "CLASH_ROYALE_INVALID_DATA");
  const timedOut = await handleRequest(request(), env(), null, {
    cache: null,
    fetchImpl: async () => { throw new DOMException("timeout", "TimeoutError"); },
  });
  assert.equal(timedOut.status, 504);
  const network = await handleRequest(request(), env(), null, {
    cache: null,
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  });
  assert.equal(network.status, 502);
});

test("the default export forwards to handleRequest", async () => {
  const response = await worker.fetch(request("/missing"), env(), null);
  assert.equal(response.status, 404);
});

// --- local-proxy.mjs --------------------------------------------------------

test("parsePort reads --port forms and rejects bad values", () => {
  assert.equal(parsePort([]), 8787);
  assert.equal(parsePort(["--port", "9000"]), 9000);
  assert.equal(parsePort(["--port=0"]), 0);
  assert.throws(() => parsePort(["--port", "abc"]), /--port must be/);
  assert.throws(() => parsePort(["--port", "70000"]), /--port must be/);
});

test("createMemoryCache expires entries after the TTL", async () => {
  let now = FIXED_NOW;
  const cache = createMemoryCache(() => now);
  assert.equal(await cache.match("k"), undefined);
  await cache.put(new Request("https://x.example/k"), new Response("body", { headers: { "X-Test": "1" } }));
  const hit = await cache.match(new Request("https://x.example/k"));
  assert.equal(await hit.text(), "body");
  assert.equal(hit.headers.get("x-test"), "1");
  now += 300_001;
  assert.equal(await cache.match("https://x.example/k"), undefined);
});

test("startLocalProxy serves the worker over HTTP with the environment key", async () => {
  const { calls, fetchImpl } = mockFetch();
  const proxy = await startLocalProxy({
    port: 0,
    env: { CLASH_ROYALE_API_KEY: "local-token", PLAYER_TAG: `#${TAG}` },
    fetchImpl,
    now: () => FIXED_NOW,
  });
  try {
    const response = await fetch(`${proxy.url}/clash-royale?tag=${TAG}`, { headers: { Origin: "http://127.0.0.1:4173" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
    const payload = await response.json();
    assert.equal(payload.player.tag, `#${TAG}`);
    assert.equal(calls[0].init.headers.Authorization, "Bearer local-token");
    const cached = await fetch(`${proxy.url}/clash-royale`);
    assert.equal((await cached.json()).fetchedAt, payload.fetchedAt);
    assert.equal(calls.length, 2);
    const missing = await fetch(`${proxy.url}/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await proxy.close();
  }

  const unconfigured = await startLocalProxy({ port: 0, env: {}, fetchImpl });
  try {
    const response = await fetch(`${unconfigured.url}/clash-royale?tag=${TAG}`);
    assert.equal(response.status, 503);
  } finally {
    await unconfigured.close();
  }
});
