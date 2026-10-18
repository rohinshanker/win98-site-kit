// Standalone Cloudflare Worker for the Clash Royale Stats app. GET
// /clash-royale?tag=TAG (or the PLAYER_TAG var) fetches the player's profile
// and battle log from the official API through RoyaleAPI's proxy with the
// CLASH_ROYALE_API_KEY secret, returns only allowlisted fields, answers CORS
// for ALLOWED_ORIGINS and caches each snapshot for five minutes. No imports:
// local-proxy.mjs runs the same handler under Node.

export const CACHE_TTL_SECONDS = 300;
export const ENDPOINT_PATH = "/clash-royale";

const API_ROOT = "https://proxy.royaleapi.dev/v1/players/";
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_BATTLELOG_BYTES = 1024 * 1024;
const MAX_CACHED_PAYLOAD_BYTES = 512 * 1024;
const CACHE_SCHEMA_VERSION = "1";
const MAX_BATTLES = 20;
const MAX_CARDS = 16;
const MAX_CURRENT_DECK_CARDS = 8;
const MAX_TEXT_LENGTH = 256;
const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;
const MAX_RATE_LIMIT_RETRY_MS = 60_000;
const ASSET_HOST = "api-assets.clashroyale.com";
const CARD_ASSET_PATH = "/cards/300/";
const EVOLUTION_ASSET_PATH = "/cardevolutions/300/";
const HERO_ASSET_PATH = "/cardheroes/300/";
const VARIABLE_ELIXIR_CARD_IDS = new Set([28000006]);
const CARD_RARITIES = new Set(["common", "rare", "epic", "legendary", "champion"]);
const TAG_PATTERN = /^[A-Z0-9]{3,20}$/;

export class HttpError extends Error {
  constructor(status, message, { retryAfterMs = 0, code = "" } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const upstreamDataError = () =>
  new HttpError(502, "Clash Royale returned invalid data", { code: "CLASH_ROYALE_INVALID_DATA" });

const requiredText = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT_LENGTH) throw upstreamDataError();
  return value;
};

const optionalText = (value) =>
  typeof value === "string" && value.trim() && value.length <= MAX_TEXT_LENGTH ? value : undefined;

const optionalInteger = (value, { allowNegative = false } = {}) =>
  Number.isSafeInteger(value) && (allowNegative || value >= 0) ? value : undefined;

const optionalRarity = (value) => {
  if (typeof value !== "string") return undefined;
  const rarity = value.trim().toLowerCase();
  return CARD_RARITIES.has(rarity) ? rarity : undefined;
};

/** "#abc" / "abc" → "ABC"; empty when the value is not a plausible tag. */
export const normalizeTag = (value) => {
  const tag = String(value ?? "").trim().replace(/^#/, "").toUpperCase();
  return TAG_PATTERN.test(tag) ? tag : "";
};

const requiredTag = (value) => {
  const tag = normalizeTag(requiredText(value));
  if (!tag) throw upstreamDataError();
  return `#${tag}`;
};

const optionalAssetUrl = (value, pathPrefix) => {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === ASSET_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(pathPrefix) &&
      url.pathname.endsWith(".png")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const compact = (entries) => Object.fromEntries(entries.filter(([, value]) => value !== undefined));

const normalizeClan = (value) => {
  if (!isRecord(value)) return undefined;
  return compact([
    ["tag", requiredTag(value.tag)],
    ["name", requiredText(value.name)],
    ["badgeId", optionalInteger(value.badgeId)],
  ]);
};

const normalizeNamedId = (value) => {
  if (!isRecord(value)) return undefined;
  const id = optionalInteger(value.id);
  const name = optionalText(value.name);
  if (id === undefined || name === undefined) return undefined;
  return { id, name };
};

const normalizeCard = (value) => {
  if (!isRecord(value)) throw upstreamDataError();
  const id = optionalInteger(value.id);
  if (id === undefined) throw upstreamDataError();
  const iconUrl = optionalAssetUrl(value.iconUrls?.medium, CARD_ASSET_PATH);
  const variant = value.evolutionLevel === 1 ? "evo" : value.evolutionLevel === 2 ? "hero" : undefined;
  const variantIconUrl =
    variant === "evo"
      ? optionalAssetUrl(value.iconUrls?.evolutionMedium, EVOLUTION_ASSET_PATH)
      : variant === "hero"
        ? optionalAssetUrl(value.iconUrls?.heroMedium, HERO_ASSET_PATH)
        : undefined;
  return compact([
    ["id", id],
    ["name", requiredText(value.name)],
    ["level", optionalInteger(value.level)],
    ["maxLevel", optionalInteger(value.maxLevel)],
    ["starLevel", optionalInteger(value.starLevel)],
    ["evolutionLevel", optionalInteger(value.evolutionLevel)],
    ["elixirCost", VARIABLE_ELIXIR_CARD_IDS.has(id) ? undefined : optionalInteger(value.elixirCost)],
    ["rarity", optionalRarity(value.rarity)],
    ["variant", variant],
    ["iconUrl", iconUrl],
    ["variantIconUrl", variantIconUrl],
  ]);
};

const normalizeCards = (value, limit = MAX_CARDS) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw upstreamDataError();
  return value.slice(0, limit).map(normalizeCard);
};

const normalizeParticipant = (value) => {
  if (!isRecord(value)) throw upstreamDataError();
  return compact([
    ["tag", requiredTag(value.tag)],
    ["name", requiredText(value.name)],
    ["crowns", optionalInteger(value.crowns)],
    ["trophyChange", optionalInteger(value.trophyChange, { allowNegative: true })],
    ["clan", normalizeClan(value.clan)],
    ["cards", normalizeCards(value.cards)],
  ]);
};

const normalizeParticipants = (value) => {
  if (!Array.isArray(value) || value.length === 0) throw upstreamDataError();
  return value.slice(0, 4).map(normalizeParticipant);
};

const normalizeBattle = (value) => {
  if (!isRecord(value)) throw upstreamDataError();
  return compact([
    ["battleTime", requiredText(value.battleTime)],
    ["type", optionalText(value.type)],
    ["gameMode", normalizeNamedId(value.gameMode)],
    ["deckSelection", optionalText(value.deckSelection)],
    ["team", normalizeParticipants(value.team)],
    ["opponent", normalizeParticipants(value.opponent)],
  ]);
};

/**
 * Shapes the upstream profile and battle log into the payload the app reads:
 * `{ ok, player, battles, fetchedAt, cacheTtlSeconds }` with allowlisted
 * fields only. `expectedTag` is the tag that was requested.
 */
export const normalizeClashRoyalePayload = (profile, battlelog, fetchedAt, expectedTag) => {
  if (!isRecord(profile) || !Array.isArray(battlelog)) throw upstreamDataError();
  const tag = requiredTag(profile.tag);
  if (tag !== `#${normalizeTag(expectedTag)}`) throw upstreamDataError();
  return {
    ok: true,
    player: compact([
      ["tag", tag],
      ["name", requiredText(profile.name)],
      ["trophies", optionalInteger(profile.trophies)],
      ["bestTrophies", optionalInteger(profile.bestTrophies)],
      ["wins", optionalInteger(profile.wins)],
      ["losses", optionalInteger(profile.losses)],
      ["battleCount", optionalInteger(profile.battleCount)],
      ["threeCrownWins", optionalInteger(profile.threeCrownWins)],
      ["clan", normalizeClan(profile.clan)],
      ["arena", normalizeNamedId(profile.arena)],
      ["currentDeck", normalizeCards(profile.currentDeck, MAX_CURRENT_DECK_CARDS) ?? []],
    ]),
    battles: battlelog.slice(0, MAX_BATTLES).map(normalizeBattle),
    fetchedAt: new Date(fetchedAt).toISOString(),
    cacheTtlSeconds: CACHE_TTL_SECONDS,
  };
};

// --- CORS -------------------------------------------------------------------

const normalizeOrigin = (origin) => {
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
};

/** ALLOWED_ORIGINS is a comma-separated list of origins; "*" allows any. */
export const allowedCorsOrigin = (request, env) => {
  const requestOrigin = normalizeOrigin(request.headers.get("Origin"));
  if (!requestOrigin) return "";
  const allowed = String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowed.includes("*")) return requestOrigin;
  return allowed.map(normalizeOrigin).includes(requestOrigin) ? requestOrigin : "";
};

export const corsHeaders = (request, env) => {
  const origin = allowedCorsOrigin(request, env);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

export const jsonResponse = (request, env, body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });

export const errorResponse = (request, env, error) => {
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  const retryAfterMs = known && Number.isSafeInteger(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : 0;
  return jsonResponse(
    request,
    env,
    {
      ok: false,
      error: known ? error.message : "Internal server error",
      ...(known && error.code ? { code: error.code } : {}),
      ...(retryAfterMs ? { retryAfterMs } : {}),
    },
    status,
    retryAfterMs
      ? {
          "Access-Control-Expose-Headers": "Retry-After",
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        }
      : {}
  );
};

// --- Upstream ---------------------------------------------------------------

const readBoundedText = async (response, maxBytes) => {
  const contentLength = Number(response.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw upstreamDataError();
  if (!response.body) throw upstreamDataError();
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw upstreamDataError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};

const readBoundedJson = async (response, maxBytes) => {
  try {
    return JSON.parse(await readBoundedText(response, maxBytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new HttpError(504, "Clash Royale request timed out", { code: "CLASH_ROYALE_TIMEOUT" });
    }
    throw upstreamDataError();
  }
};

const retryAfterMs = (value, nowMs) => {
  const seconds = Number(value);
  let delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - nowMs;
  if (!Number.isFinite(delay) || delay <= 0) delay = DEFAULT_RATE_LIMIT_RETRY_MS;
  return Math.min(Math.ceil(delay), MAX_RATE_LIMIT_RETRY_MS);
};

const assertUpstreamSuccess = (response, nowMs) => {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(502, "Clash Royale upstream authentication failed", { code: "CLASH_ROYALE_UPSTREAM_AUTH" });
  }
  if (response.status === 404) {
    throw new HttpError(502, "Clash Royale player was not found", { code: "CLASH_ROYALE_PLAYER_NOT_FOUND" });
  }
  if (response.status === 429) {
    throw new HttpError(429, "Clash Royale request limit reached", {
      code: "CLASH_ROYALE_RATE_LIMITED",
      retryAfterMs: retryAfterMs(response.headers.get("Retry-After") || "", nowMs),
    });
  }
  throw new HttpError(502, "Clash Royale data is temporarily unavailable", { code: "CLASH_ROYALE_UPSTREAM_ERROR" });
};

const fetchUpstream = async (url, token, fetchImpl) => {
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new HttpError(504, "Clash Royale request timed out", { code: "CLASH_ROYALE_TIMEOUT" });
    }
    throw new HttpError(502, "Clash Royale data is temporarily unavailable", { code: "CLASH_ROYALE_UPSTREAM_ERROR" });
  }
};

const cancelResponseBody = async (response) => {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The transport may already have closed the body.
  }
};

// --- Cache ------------------------------------------------------------------

const cacheStorage = () => {
  try {
    return globalThis.caches?.default || null;
  } catch {
    return null;
  }
};

const cacheKey = (request, tag) => {
  const url = new URL(request.url);
  url.pathname = ENDPOINT_PATH;
  url.search = "";
  url.searchParams.set("schema", CACHE_SCHEMA_VERSION);
  url.searchParams.set("tag", tag);
  return new Request(url.toString(), { method: "GET" });
};

const cachedPayload = async (cache, key, tag) => {
  if (!cache) return null;
  try {
    const response = await cache.match(key);
    if (!response) return null;
    const payload = JSON.parse(await readBoundedText(response, MAX_CACHED_PAYLOAD_BYTES));
    const valid =
      payload?.ok === true &&
      payload.player?.tag === `#${tag}` &&
      Array.isArray(payload.battles) &&
      payload.cacheTtlSeconds === CACHE_TTL_SECONDS &&
      !Number.isNaN(Date.parse(payload.fetchedAt));
    return valid ? payload : null;
  } catch {
    return null;
  }
};

const cachePayload = async (cache, key, payload, context) => {
  if (!cache) return;
  const response = new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  const write = cache.put(key, response).catch(() => {});
  if (typeof context?.waitUntil === "function") context.waitUntil(write);
  else await write;
};

// --- Request handling -------------------------------------------------------

/** The tag to serve: PLAYER_TAG when set (the query must match it), else ?tag. */
export const resolveRequestedTag = (requestUrl, env) => {
  const fixedTag = normalizeTag(env.PLAYER_TAG);
  const rawQuery = requestUrl.searchParams.get("tag");
  const queryTag = rawQuery === null ? "" : normalizeTag(rawQuery);
  if (rawQuery !== null && !queryTag) throw new HttpError(400, "Invalid player tag");
  if (fixedTag) {
    if (queryTag && queryTag !== fixedTag) {
      throw new HttpError(403, "This proxy serves a fixed player tag", { code: "CLASH_ROYALE_TAG_MISMATCH" });
    }
    return fixedTag;
  }
  if (!queryTag) throw new HttpError(400, "A player tag is required (?tag=XXXX or the PLAYER_TAG var)");
  return queryTag;
};

export const handleClashRoyaleRequest = async (
  request,
  env,
  context,
  { fetchImpl = globalThis.fetch, cache = cacheStorage(), now = Date.now } = {}
) => {
  const requestUrl = new URL(request.url);
  const tag = resolveRequestedTag(requestUrl, env);
  const token = env.CLASH_ROYALE_API_KEY;
  if (typeof token !== "string" || !token.trim()) {
    throw new HttpError(503, "Clash Royale data is temporarily unavailable", { code: "CLASH_ROYALE_NOT_CONFIGURED" });
  }
  const key = cacheKey(request, tag);
  const cached = await cachedPayload(cache, key, tag);
  if (cached) return jsonResponse(request, env, cached);

  const fetchedAt = now();
  const playerUrl = `${API_ROOT}${encodeURIComponent(`#${tag}`)}`;
  const [profileResponse, battlelogResponse] = await Promise.all([
    fetchUpstream(playerUrl, token, fetchImpl),
    fetchUpstream(`${playerUrl}/battlelog`, token, fetchImpl),
  ]);
  try {
    assertUpstreamSuccess(profileResponse, fetchedAt);
    assertUpstreamSuccess(battlelogResponse, fetchedAt);
  } catch (error) {
    await Promise.all([cancelResponseBody(profileResponse), cancelResponseBody(battlelogResponse)]);
    throw error;
  }
  const [profile, battlelog] = await Promise.all([
    readBoundedJson(profileResponse, MAX_PROFILE_BYTES),
    readBoundedJson(battlelogResponse, MAX_BATTLELOG_BYTES),
  ]);
  const payload = normalizeClashRoyalePayload(profile, battlelog, fetchedAt, tag);
  await cachePayload(cache, key, payload, context);
  return jsonResponse(request, env, payload);
};

/** Routes one request: CORS preflight, GET /clash-royale, 404 otherwise. */
export const handleRequest = async (request, env, context, options = {}) => {
  try {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname !== ENDPOINT_PATH) throw new HttpError(404, "Not found");
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    if (request.headers.get("Origin") && !allowedCorsOrigin(request, env)) {
      throw new HttpError(403, "Origin is not allowed");
    }
    return await handleClashRoyaleRequest(request, env, context, options);
  } catch (error) {
    return errorResponse(request, env, error);
  }
};

export default {
  fetch: (request, env, context) => handleRequest(request, env, context),
};
