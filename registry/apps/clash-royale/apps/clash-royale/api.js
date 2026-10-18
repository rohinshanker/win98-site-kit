// Pure helpers for the Clash Royale Stats app: settings resolution, response
// validation, battle classification and the text formatters. No DOM, no
// window; node tests import this file directly.

export const CLASH_ENDPOINT_PATH = "/clash-royale";
export const CLASH_CACHE_TTL_SECONDS = 300;
export const CLASH_MAX_CURRENT_DECK_CARDS = 8;
export const CLASH_MAX_PARTICIPANT_DECK_CARDS = 16;
export const CLASH_MAX_BATTLES = 20;
export const CLASH_REQUEST_TIMEOUT_MS = 10_000;
export const CLASH_STORAGE_PREFIX = "win98SiteKit.clash-royale.";
export const EMPTY_VALUE = "—";

const CLASH_CARD_ASSET_HOSTNAME = "api-assets.clashroyale.com";
const CLASH_MIRROR_CARD_ID = "28000006";
const CLASH_CARD_RARITIES = Object.freeze(["common", "rare", "epic", "legendary", "champion"]);
const CLASH_CARD_VARIANTS = Object.freeze(["evo", "hero"]);
const CLASH_TAG_PATTERN = /^[A-Z0-9]{3,20}$/;

export const normalizeClashTag = (tag) =>
  String(tag ?? "")
    .trim()
    .replace(/^#/, "")
    .toUpperCase();

/** A normalized tag is usable when it matches the official tag alphabet. */
export const isValidClashTag = (tag) => CLASH_TAG_PATTERN.test(normalizeClashTag(tag));

/** Keeps only a plain http(s) origin plus path: no credentials, query or hash. */
export const normalizeProxyBaseUrl = (rawUrl) => {
  const text = String(rawUrl ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
      return "";
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

/**
 * Merges config.js with the runtime overrides (localStorage values keyed
 * `win98SiteKit.clash-royale.playerTag` / `.proxyBaseUrl`). Overrides win
 * when set; an unusable proxy URL resolves to "" so the setup notice shows.
 */
export const resolveClashSettings = (config = {}, overrides = {}) => {
  const playerTag = normalizeClashTag(
    String(overrides.playerTag ?? "").trim() || config.playerTag
  );
  return Object.freeze({
    playerTag: isValidClashTag(playerTag) ? playerTag : "",
    proxyBaseUrl: normalizeProxyBaseUrl(
      String(overrides.proxyBaseUrl ?? "").trim() || config.proxyBaseUrl
    ),
  });
};

/** `GET {proxy}/clash-royale?tag=TAG`; the tag is omitted when unknown. */
export const buildClashSnapshotUrl = (proxyBaseUrl, playerTag) => {
  const base = normalizeProxyBaseUrl(proxyBaseUrl);
  if (!base) return "";
  const tag = normalizeClashTag(playerTag);
  return `${base}${CLASH_ENDPOINT_PATH}${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
};

export const royaleApiProfileUrl = (playerTag) => {
  const tag = normalizeClashTag(playerTag);
  return tag ? `https://royaleapi.com/player/${encodeURIComponent(tag)}` : "https://royaleapi.com/";
};

export const normalizeClashCardIconUrl = (value) => {
  try {
    const url = new URL(String(value ?? "").trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== CLASH_CARD_ASSET_HOSTNAME ||
      url.username ||
      url.password ||
      !url.pathname.toLowerCase().endsWith(".png")
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
};

export const normalizeClashCardRarity = (value) => {
  const rarity = String(value ?? "").trim().toLowerCase();
  return CLASH_CARD_RARITIES.includes(rarity) ? rarity : "";
};

export const normalizeClashCardVariant = (value) => {
  const variant = String(value ?? "").trim().toLowerCase();
  return CLASH_CARD_VARIANTS.includes(variant) ? variant : "";
};

export const isVariableClashElixirCard = (card) =>
  String(card?.id ?? "").trim() === CLASH_MIRROR_CARD_ID;

export const isFiniteNonnegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const isValidElixirCost = (value) => isFiniteNonnegative(value) && Number.isInteger(value);

export const calculateAverageElixir = (cards) => {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  if (cards.some(isVariableClashElixirCard)) return null;
  const costs = cards.map((card) => card?.elixirCost);
  if (!costs.every(isValidElixirCost)) return null;
  return costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
};

const isParticipant = (value) =>
  Boolean(value && typeof value === "object" && normalizeClashTag(value.tag));

const findParticipant = (participants, playerTag) =>
  participants.find((participant) => normalizeClashTag(participant.tag) === playerTag);

/** Works out which side the player was on and the battle outcome. */
export const resolveClashBattle = (battle, rawPlayerTag) => {
  if (!battle || typeof battle !== "object") return null;
  const playerTag = normalizeClashTag(rawPlayerTag);
  if (!playerTag) return null;

  const team = Array.isArray(battle.team) ? battle.team.filter(isParticipant) : [];
  const opponentTeam = Array.isArray(battle.opponent) ? battle.opponent.filter(isParticipant) : [];
  const teamPlayer = findParticipant(team, playerTag);
  const opponentPlayer = findParticipant(opponentTeam, playerTag);
  const player = teamPlayer ?? opponentPlayer;
  const playerSide = teamPlayer ? team : opponentTeam;
  const opponents = teamPlayer ? opponentTeam : team;
  const opponent = opponents[0];
  if (!player || !opponent) return null;
  const allies = playerSide.filter((participant) => normalizeClashTag(participant.tag) !== playerTag);

  const hasCrowns = isFiniteNonnegative(player.crowns) && isFiniteNonnegative(opponent.crowns);
  const outcome = !hasCrowns
    ? "unknown"
    : player.crowns > opponent.crowns
      ? "win"
      : player.crowns < opponent.crowns
        ? "loss"
        : "draw";

  return { allies, battle, hasCrowns, opponent, opponents, outcome, player, playerSide };
};

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validates a proxy payload and resolves its battles. `expectedTag`, when
 * given, must match the player the proxy returned.
 */
export const prepareClashSnapshot = (payload, expectedTag = "") => {
  if (!payload || payload.ok !== true || !payload.player || typeof payload.player !== "object") {
    throw new TypeError("Invalid Clash Royale response");
  }
  const playerTag = normalizeClashTag(payload.player.tag);
  if (!isValidClashTag(playerTag)) throw new TypeError("Invalid Clash Royale player tag");
  const wantedTag = normalizeClashTag(expectedTag);
  if (wantedTag && playerTag !== wantedTag) throw new TypeError("Invalid Clash Royale player tag");
  if (typeof payload.fetchedAt !== "string" || !ISO_TIMESTAMP.test(payload.fetchedAt.trim())) {
    throw new TypeError("Invalid Clash Royale fetch timestamp");
  }
  const fetchedAt = new Date(payload.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) throw new TypeError("Invalid Clash Royale fetch timestamp");
  if (!Array.isArray(payload.battles) || !Array.isArray(payload.player.currentDeck)) {
    throw new TypeError("Invalid Clash Royale collections");
  }
  if (payload.cacheTtlSeconds !== CLASH_CACHE_TTL_SECONDS) {
    throw new TypeError("Invalid Clash Royale cache lifetime");
  }
  const battles = payload.battles
    .map((battle) => resolveClashBattle(battle, playerTag))
    .filter(Boolean)
    .slice(0, CLASH_MAX_BATTLES);
  const currentDeck = payload.player.currentDeck
    .filter((card) => card && typeof card === "object" && String(card.name ?? "").trim())
    .slice(0, CLASH_MAX_CURRENT_DECK_CARDS);

  return { battles, currentDeck, fetchedAt, player: payload.player, playerTag };
};

export const summarizeClashBattles = (battles) => {
  const resolved = Array.isArray(battles) ? battles : [];
  const known = resolved.filter((battle) => battle.hasCrowns);
  const wins = known.filter((battle) => battle.outcome === "win").length;
  const losses = known.filter((battle) => battle.outcome === "loss").length;
  const draws = known.filter((battle) => battle.outcome === "draw").length;
  const crownDifference = known.reduce(
    (total, battle) => total + battle.player.crowns - battle.opponent.crowns,
    0
  );
  return { crownDifference, draws, known: known.length, losses, total: resolved.length, wins };
};

export const formatSampleSummary = (summary) => {
  if (summary.total === 0) return "No usable battles";
  if (summary.known === 0) {
    return `${summary.total} battle${summary.total === 1 ? "" : "s"}; results unavailable`;
  }
  return (
    `${summary.wins}W–${summary.losses}L–${summary.draws}D · ` +
    `${summary.crownDifference > 0 ? "+" : ""}${summary.crownDifference} crowns`
  );
};

/** The sentence before the RoyaleAPI link in the battle history footer. */
export const formatHistoryPrefix = (battleCount) => {
  if (battleCount === CLASH_MAX_BATTLES) return `Most recent ${CLASH_MAX_BATTLES} battles loaded. View `;
  if (battleCount > 0) return `Most recent ${battleCount} battle${battleCount === 1 ? "" : "s"} loaded. View `;
  return "No recent battles loaded. View ";
};

export const formatLoadedStatus = (battleCount) =>
  battleCount
    ? `Player data loaded with ${battleCount} recent battle${battleCount === 1 ? "" : "s"}.`
    : "Player data loaded. No recent battles were returned.";

export const formatClan = (clan) => {
  if (!clan || typeof clan !== "object" || !String(clan.name ?? "").trim()) return "No clan";
  const tag = String(clan.tag ?? "").trim();
  return `${String(clan.name).trim()}${tag ? ` (${tag})` : ""}`;
};

export const formatWinRate = (wins, losses) => {
  if (!isFiniteNonnegative(wins) || !isFiniteNonnegative(losses)) return EMPTY_VALUE;
  const decided = wins + losses;
  return decided > 0 ? `${((wins / decided) * 100).toFixed(1)}%` : EMPTY_VALUE;
};

export const parseClashBattleTime = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const compactMatch = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d{1,3})?Z$/);
  const timestamp = compactMatch
    ? `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}T${compactMatch[4]}:${compactMatch[5]}:${compactMatch[6]}${compactMatch[7] ?? ""}Z`
    : text;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatClashBattleMode = (battle) =>
  String(battle?.gameMode?.name ?? "").trim() || String(battle?.type ?? "").trim() || "Battle";

const MODE = (key, label) => Object.freeze({ key, label });

const CLASH_MODE_BY_ID = new Map([
  [72000007, MODE("friendly", "Friendly")],
  [72000014, MODE("two-v-two", "2v2")],
  [72000023, MODE("two-v-two", "2v2")],
  [72000098, MODE("clan-war", "Clan War")],
  [72000101, MODE("clan-war", "Clan War")],
  [72000102, MODE("clan-war", "Clan War")],
  [72000266, MODE("clan-war", "Clan War")],
  [72000267, MODE("clan-war", "Clan War")],
  [72000268, MODE("clan-war", "Clan War")],
]);

const CLASH_CLAN_WAR_TYPES = new Set(["boatBattle", "riverRacePvP", "riverRaceDuel", "riverRaceDuelColosseum"]);

/** Exact type/id mapping to a badge; unknown modes stay "Other". */
export const classifyClashBattleMode = (battle) => {
  const type = String(battle?.type ?? "").trim();
  if (CLASH_CLAN_WAR_TYPES.has(type)) return MODE("clan-war", "Clan War");
  if (type === "pathOfLegend") return MODE("ranked", "Ranked");
  if (type === "challenge") return MODE("challenge", "Challenge");
  if (type === "PvP" && battle?.gameMode?.id === 72000006) return MODE("ladder", "Ladder");
  return CLASH_MODE_BY_ID.get(battle?.gameMode?.id) ?? MODE("other", "Other");
};

export const participantName = (participant) =>
  String(participant?.name ?? participant?.tag ?? "Unknown player").trim() || "Unknown player";

export const formatMatchup = ({ opponents, playerSide }) =>
  `${playerSide.map(participantName).join(" & ")} vs. ${opponents.map(participantName).join(" & ")}`;

/** The user-facing message for a failed proxy response. */
export const errorMessageFor = (status, payload) => {
  if (status === 429) {
    const retryAfterMs = Number(payload?.retryAfterMs);
    const retryText =
      Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? ` Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
        : " Try again shortly.";
    return `Too many refreshes.${retryText}`;
  }
  if (status === 503) return "Player data is temporarily unavailable. Try again later.";
  if (status === 504) return "The player data request timed out. Try again.";
  if (status === 502) return "Clash Royale returned an error. Try again later.";
  if (status === 403) return "The proxy refused this player tag. Check config.js and the proxy's PLAYER_TAG.";
  return "Player data could not be loaded. Try again.";
};
