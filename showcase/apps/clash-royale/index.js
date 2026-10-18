// Clash Royale Stats: a player profile, current deck with card art and the
// last 20 battles, fetched from the optional proxy in proxy/clash-royale/
// (config.js holds the player tag and proxy URL). Pure logic lives in api.js.

import { escapeHtml, storage } from "../../kit/index.js";
import config from "./config.js";
import {
  CLASH_MAX_PARTICIPANT_DECK_CARDS,
  CLASH_REQUEST_TIMEOUT_MS,
  CLASH_STORAGE_PREFIX,
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
  isFiniteNonnegative,
  isValidElixirCost,
  isVariableClashElixirCard,
  normalizeClashCardIconUrl,
  normalizeClashCardRarity,
  normalizeClashCardVariant,
  parseClashBattleTime,
  participantName,
  prepareClashSnapshot,
  resolveClashSettings,
  royaleApiProfileUrl,
  summarizeClashBattles,
} from "./api.js";

const TROPHY_ICON = "assets/icon/trophy.svg";
const CROWN_ICON = "assets/pixelarticons/crown.svg";
const POTION_ICON = "assets/pixelarticons/potion.svg";
const DIGIT_SOURCES = Object.freeze(
  Object.fromEntries(
    [..."0123456789-"].map((digit) => [
      digit,
      `assets/clash-royale/digits/digital_${digit === "-" ? "minus" : digit}.png`,
    ])
  )
);

const settings = resolveClashSettings(config, {
  playerTag: storage.readString(`${CLASH_STORAGE_PREFIX}playerTag`, ""),
  proxyBaseUrl: storage.readString(`${CLASH_STORAGE_PREFIX}proxyBaseUrl`, ""),
});

const statRow = (id, label, icon, featured = false) => `
  <div class="cr-stat${featured ? " cr-stat--featured" : ""}">
    <dt><img class="cr-stat-icon" data-src="${icon}" width="16" height="16" alt="" />${label}</dt>
    <dd id="${id}">${EMPTY_VALUE}</dd>
  </div>`;

const setupNoticeHtml = () => `
  <section class="cr-setup" id="cr-setup" aria-labelledby="cr-setup-heading">
    <h2 class="cr-section-title" id="cr-setup-heading">Set up Clash Royale Stats</h2>
    <p>This window shows a player's profile, current deck and recent battles from the
      official Clash Royale API. The API needs a secret key, so a small proxy
      (the only server-side piece in the kit) keeps it off the page. One-time setup:</p>
    <ol class="cr-setup-steps">
      <li>Create an API key at <a href="https://developer.clashroyale.com/" target="_blank" rel="noopener noreferrer">developer.clashroyale.com</a>
        and allowlist the RoyaleAPI proxy IP (<code>45.79.218.79</code>).</li>
      <li>Deploy <code>proxy/clash-royale/worker.mjs</code> to Cloudflare Workers following
        <code>proxy/clash-royale/README.md</code> (store the key with <code>wrangler secret put CLASH_ROYALE_API_KEY</code>).</li>
      <li>Open <code>apps/clash-royale/config.js</code>: set <code>playerTag</code> to your tag and
        <code>proxyBaseUrl</code> to the deployed URL, then reload.</li>
    </ol>
    <p class="cr-setup-note">Developing locally? <code>node proxy/clash-royale/local-proxy.mjs --port 8787</code>
      serves the same endpoint from the <code>CLASH_ROYALE_API_KEY</code> environment variable.</p>
  </section>`;

const render = () => `
  <div class="cr-app${settings.proxyBaseUrl ? "" : " is-unconfigured"}" id="cr-app" aria-busy="false">
    ${settings.proxyBaseUrl ? "" : setupNoticeHtml()}
    <span class="cr-status" id="cr-status" role="status" aria-live="polite" aria-atomic="true">
      Open the app to load player data.
    </span>
    <section class="cr-panel cr-player-panel" aria-labelledby="cr-player-heading">
      <h2 class="cr-section-title" id="cr-player-heading">Player</h2>
      <div class="cr-player-header" id="cr-player-card">
        <div class="cr-title-row">
          <strong class="cr-player-name" id="cr-player-name">Player data has not loaded.</strong>
          <span class="cr-tag" id="cr-player-tag">${settings.playerTag ? `#${escapeHtml(settings.playerTag)}` : EMPTY_VALUE}</span>
          <a class="cr-profile-link" id="cr-profile-link" href="${escapeHtml(royaleApiProfileUrl(settings.playerTag))}"
            target="_blank" rel="noopener noreferrer">View on RoyaleAPI</a>
        </div>
        <dl class="cr-stat-grid">
          ${statRow("cr-trophies", "Trophies", TROPHY_ICON, true)}
          ${statRow("cr-best-trophies", "Best", TROPHY_ICON, true)}
          ${statRow("cr-arena", "Arena", "assets/app-icons/ico/world_star.ico")}
          ${statRow("cr-clan", "Clan", "assets/app-icons/ico/users.ico")}
          ${statRow("cr-career-record", "Career record", "assets/app-icons/ico/certificate_multiple.ico")}
          ${statRow("cr-career-win-rate", "Win rate", "assets/app-icons/ico/calculator.ico")}
          ${statRow("cr-battle-count", "Battles", "assets/pixelarticons/sword.svg", true)}
          ${statRow("cr-three-crown-wins", "Three-crown wins", CROWN_ICON, true)}
        </dl>
        <div class="cr-player-footer">
          <p class="cr-updated">Last updated: <time id="cr-last-updated">${EMPTY_VALUE}</time></p>
          <button id="cr-refresh" class="default cr-refresh" type="button" aria-controls="cr-app">Refresh</button>
        </div>
      </div>
    </section>
    <section class="cr-panel" aria-labelledby="cr-deck-heading">
      <div class="cr-section-heading-row cr-deck-heading-row">
        <h2 class="cr-section-title" id="cr-deck-heading">Current Deck</h2>
        <span class="cr-deck-average" id="cr-deck-average">Average Elixir: ${EMPTY_VALUE}</span>
      </div>
      <ul class="cr-deck-row cr-current-deck" id="cr-current-deck">
        <li class="cr-empty">No deck loaded.</li>
      </ul>
    </section>
    <section class="cr-panel cr-battles-panel" aria-labelledby="cr-battles-heading">
      <div class="cr-section-heading-row">
        <h2 class="cr-section-title" id="cr-battles-heading">Recent Battles</h2>
        <span class="cr-sample-summary" id="cr-sample-summary">${EMPTY_VALUE}</span>
      </div>
      <div class="cr-battle-scroll" id="cr-battle-scroll" role="region" tabindex="0" aria-labelledby="cr-battles-heading">
        <ol class="cr-battle-list" id="cr-battle-log">
          <li class="cr-empty">No battles loaded.</li>
        </ol>
        <p class="cr-history-footer" id="cr-history-footer">
          No recent battles loaded. View
          <a href="${escapeHtml(royaleApiProfileUrl(settings.playerTag))}" target="_blank" rel="noopener noreferrer">Royale API</a>
          for full list.
        </p>
      </div>
    </section>
  </div>`;

const createElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const createDecorativeIcon = (source, className) => {
  const image = document.createElement("img");
  image.className = className;
  image.src = source;
  image.alt = "";
  return image;
};

const createDigitValue = (value, accessibleText, minimumLength = 1) => {
  const wrapper = createElement("span", "cr-digit-value");
  const digits = String(value).padStart(minimumLength, " ");
  const strip = createElement("span", "cr-digit-strip");
  strip.setAttribute("aria-hidden", "true");
  [...digits].forEach((digit) => {
    if (digit === " ") {
      strip.appendChild(createElement("span", "cr-digit-space"));
      return;
    }
    const source = DIGIT_SOURCES[digit];
    if (source) strip.appendChild(createDecorativeIcon(source, "cr-digit-image"));
  });
  wrapper.append(strip, createElement("span", "visually-hidden", accessibleText));
  return wrapper;
};

const renderDigitValue = (container, value, minimumLength) => {
  if (!isFiniteNonnegative(value)) {
    container.textContent = EMPTY_VALUE;
    return;
  }
  const integer = Math.trunc(value);
  container.replaceChildren(createDigitValue(String(integer), integer.toLocaleString(), minimumLength));
};

const createBattleMetric = ({ accessibleText, icon, sign = "", value, minimumLength = 1 }) => {
  const metric = createElement("span", "cr-battle-metric");
  metric.appendChild(createDecorativeIcon(icon, "cr-battle-metric-icon"));
  if (sign) {
    const signElement = createElement("span", "cr-battle-metric-sign", sign);
    signElement.setAttribute("aria-hidden", "true");
    metric.appendChild(signElement);
  }
  metric.appendChild(createDigitValue(value, accessibleText, minimumLength));
  return metric;
};

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const handleCardImageError = (image, item) => {
  const fallbackUrl = image.dataset.fallbackSrc;
  if (fallbackUrl) {
    delete image.dataset.fallbackSrc;
    image.src = fallbackUrl;
    return;
  }
  image.remove();
  item.classList.add("is-image-unavailable");
};

const createCardItem = (card, { compact = false, deferImage = false } = {}) => {
  const cardName = String(card?.name ?? "").trim() || "Unnamed card";
  const rarity = normalizeClashCardRarity(card?.rarity);
  const variant = normalizeClashCardVariant(card?.variant);
  const regularIconUrl = normalizeClashCardIconUrl(card?.iconUrl);
  const variantIconUrl = variant ? normalizeClashCardIconUrl(card?.variantIconUrl) : "";
  const item = createElement(
    "li",
    ["cr-deck-card", compact ? "cr-deck-card--compact" : "", `is-rarity-${rarity || "unknown"}`, variant ? `is-variant-${variant}` : ""]
      .filter(Boolean)
      .join(" ")
  );
  const media = createElement("span", "cr-deck-card-media");
  const imageUrl = variantIconUrl || regularIconUrl;
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "cr-deck-card-image";
    image.alt = "";
    image.width = compact ? 36 : 72;
    image.height = compact ? 44 : 88;
    image.decoding = "async";
    if (variantIconUrl && regularIconUrl && variantIconUrl !== regularIconUrl) {
      image.dataset.fallbackSrc = regularIconUrl;
    }
    // Participant art stays in a private attribute (not data-src) so the
    // kit's media loader never hydrates collapsed battle decks on reopen.
    if (deferImage) image.dataset.crCardSrc = imageUrl;
    else image.src = imageUrl;
    image.addEventListener("error", () => handleCardImageError(image, item));
    media.appendChild(image);
  } else {
    item.classList.add("is-image-unavailable");
  }

  if (variant && compact) {
    media.appendChild(createElement("span", `cr-card-variant cr-card-variant--${variant}`, variant.toUpperCase()));
  }
  const name = createElement("span", "cr-deck-card-name", cardName);
  name.title = cardName;
  const title = createElement("span", "cr-deck-card-title");
  title.appendChild(name);
  if (variant && !compact) {
    title.appendChild(
      createElement("span", `cr-card-variant cr-card-variant--inline cr-card-variant--${variant}`, variant.toUpperCase())
    );
  }
  const metadata = createElement("span", "cr-card-metadata");
  const hasElixir = isValidElixirCost(card?.elixirCost);
  const isVariableElixir = isVariableClashElixirCard(card);
  const elixir = createElement(
    "span",
    "cr-card-elixir",
    isVariableElixir ? "+1 variable" : hasElixir ? String(card.elixirCost) : EMPTY_VALUE
  );
  const elixirIcon = createDecorativeIcon(POTION_ICON, "cr-elixir-icon");
  elixirIcon.alt = isVariableElixir || hasElixir ? "elixir" : "Elixir unavailable";
  elixir.appendChild(elixirIcon);
  metadata.append(elixir, createElement("span", "visually-hidden cr-card-rarity", rarity ? capitalize(rarity) : "Rarity unavailable"));
  item.append(title, media, metadata);
  return item;
};

const hydrateDeferredCardImages = (container) => {
  container.querySelectorAll("img[data-cr-card-src]").forEach((image) => {
    image.src = image.dataset.crCardSrc;
    delete image.dataset.crCardSrc;
  });
};

const createParticipantDecks = ({ opponents, playerSide }) => {
  const groups = [
    { label: "Your team", participants: playerSide },
    { label: "Opponents", participants: opponents },
  ]
    .map((group) => ({
      ...group,
      participants: group.participants.filter(
        (participant) =>
          Array.isArray(participant.cards) && participant.cards.some((card) => String(card?.name ?? "").trim())
      ),
    }))
    .filter((group) => group.participants.length);
  if (!groups.length) return null;

  const disclosure = createElement("details", "cr-battle-disclosure");
  disclosure.appendChild(createElement("summary", "cr-battle-disclosure-summary", "View participant decks"));
  const content = createElement("div", "cr-battle-decks");
  groups.forEach((group) => {
    const side = createElement("section", "cr-battle-side");
    side.appendChild(createElement("h3", "cr-battle-side-title", group.label));
    group.participants.forEach((participant) => {
      const participantDeck = createElement("div", "cr-participant-deck-group");
      participantDeck.appendChild(createElement("h4", "cr-participant-name", participantName(participant)));
      const cards = createElement("ul", "cr-participant-deck");
      cards.append(
        ...participant.cards
          .filter((card) => String(card?.name ?? "").trim())
          .slice(0, CLASH_MAX_PARTICIPANT_DECK_CARDS)
          .map((card) => createCardItem(card, { compact: true, deferImage: true }))
      );
      participantDeck.appendChild(cards);
      side.appendChild(participantDeck);
    });
    content.appendChild(side);
  });
  disclosure.appendChild(content);
  disclosure.addEventListener("toggle", () => {
    if (disclosure.open) hydrateDeferredCardImages(disclosure);
  });
  return disclosure;
};

const createBattleTime = (value) => {
  const parsedTime = parseClashBattleTime(value);
  const time = createElement("time", "cr-battle-time");
  if (!parsedTime) {
    time.textContent = "Time unavailable";
    return time;
  }
  time.dateTime = parsedTime.toISOString();
  time.append(
    createElement("span", "cr-battle-date", parsedTime.toLocaleDateString()),
    createElement("span", "cr-battle-clock", parsedTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
  );
  return time;
};

/** One body-level tooltip showing a badge's raw game mode name. */
const createModeHint = () => {
  let hint = null;
  let activeBadge = null;
  let dismissedBadge = null;

  const hide = () => {
    hint?.classList.remove("is-visible");
    activeBadge?.removeAttribute("aria-describedby");
    activeBadge = null;
  };

  const show = (badge, text, pointer) => {
    if (!hint) {
      hint = createElement("span", "cr-mode-hint");
      hint.id = "cr-mode-hint";
      hint.setAttribute("role", "tooltip");
      document.body.appendChild(hint);
    }
    if (activeBadge !== badge) hide();
    activeBadge = badge;
    hint.textContent = text;
    hint.classList.add("is-visible");
    badge.setAttribute("aria-describedby", hint.id);
    // 12px pointer offset, kept 4px inside the viewport.
    const offset = 12;
    const edge = 4;
    const anchor = pointer ?? badge.getBoundingClientRect();
    const x = pointer ? anchor.clientX : anchor.left + anchor.width / 2;
    const y = pointer ? anchor.clientY : anchor.bottom;
    hint.style.left = `${x + offset}px`;
    hint.style.top = `${y + offset}px`;
    const bounds = hint.getBoundingClientRect();
    const left = Math.min(x + offset, window.innerWidth - bounds.width - edge);
    const top = Math.min(y + offset, window.innerHeight - bounds.height - edge);
    hint.style.left = `${Math.max(edge, left)}px`;
    hint.style.top = `${Math.max(edge, top)}px`;
  };

  const attach = (badge, text) => {
    const showPointerHint = (event) => {
      if (dismissedBadge !== badge && event.pointerType !== "touch") show(badge, text, event);
    };
    badge.tabIndex = 0;
    badge.addEventListener("pointerenter", (event) => {
      dismissedBadge = null;
      showPointerHint(event);
    });
    badge.addEventListener("pointermove", showPointerHint);
    badge.addEventListener("pointerleave", () => {
      if (activeBadge !== badge) return;
      if (document.activeElement === badge) show(badge, text);
      else hide();
    });
    badge.addEventListener("focus", () => {
      dismissedBadge = null;
      show(badge, text);
    });
    badge.addEventListener("blur", () => {
      if (activeBadge === badge) hide();
    });
  };

  /** Escape dismisses the hint (and stops there) until a fresh hover or focus. */
  const dismissOnEscape = (event) => {
    if (event.key !== "Escape" || !activeBadge) return;
    dismissedBadge = activeBadge;
    hide();
    event.stopPropagation();
  };

  document.addEventListener("keydown", dismissOnEscape, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("visibilitychange", hide);
  return { attach, hide };
};

const readResponseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const mount = ({ window: win, body }) => {
  const byId = (id) => win.querySelector(`#${id}`);
  const elements = {
    app: byId("cr-app"),
    arena: byId("cr-arena"),
    battleCount: byId("cr-battle-count"),
    battleLog: byId("cr-battle-log"),
    battleScroll: byId("cr-battle-scroll"),
    bestTrophies: byId("cr-best-trophies"),
    careerRecord: byId("cr-career-record"),
    careerWinRate: byId("cr-career-win-rate"),
    clan: byId("cr-clan"),
    currentDeck: byId("cr-current-deck"),
    deckAverage: byId("cr-deck-average"),
    historyFooter: byId("cr-history-footer"),
    lastUpdated: byId("cr-last-updated"),
    playerName: byId("cr-player-name"),
    playerTag: byId("cr-player-tag"),
    profileLink: byId("cr-profile-link"),
    refresh: byId("cr-refresh"),
    sampleSummary: byId("cr-sample-summary"),
    status: byId("cr-status"),
    threeCrownWins: byId("cr-three-crown-wins"),
    trophies: byId("cr-trophies"),
  };
  const modeHint = createModeHint();
  let activeRequest = null;
  let hasSnapshot = false;

  const setStatus = (message, state = "idle") => {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  };

  const setLoading = (loading) => {
    elements.app.setAttribute("aria-busy", String(loading));
    elements.refresh.disabled = loading;
    elements.refresh.textContent = loading ? "Refreshing…" : "Refresh";
  };

  const renderEmptyItem = (container, message) => {
    container.replaceChildren(createElement("li", "cr-empty", message));
  };

  const renderDeck = (cards) => {
    const averageElixir = calculateAverageElixir(cards);
    elements.deckAverage.replaceChildren(
      `Average Elixir: ${averageElixir === null ? "unavailable" : averageElixir.toFixed(1)}`,
      createDecorativeIcon(POTION_ICON, "cr-elixir-icon")
    );
    if (!cards.length) {
      renderEmptyItem(elements.currentDeck, "No current deck was returned.");
      return;
    }
    elements.currentDeck.replaceChildren(...cards.map((card) => createCardItem(card)));
  };

  const renderBattles = (battles) => {
    modeHint.hide();
    if (!battles.length) {
      renderEmptyItem(elements.battleLog, "No recent battles were returned.");
      elements.battleScroll.scrollTop = 0;
      return;
    }
    const labels = { draw: "DRAW", loss: "LOSS", unknown: "N/A", win: "WIN" };
    const items = battles.map((resolvedBattle) => {
      const { battle, hasCrowns, opponent, outcome, player } = resolvedBattle;
      const item = createElement("li", `cr-battle-item is-${outcome}`);
      item.dataset.outcome = outcome;
      const summary = createElement("div", "cr-battle-summary");
      summary.appendChild(createElement("span", `cr-result is-${outcome}`, labels[outcome]));
      const info = createElement("span", "cr-battle-info");
      const details = createElement("span", "cr-battle-details");
      const mode = classifyClashBattleMode(battle);
      const modeBadge = createElement("span", `cr-battle-mode is-${mode.key}`, mode.label);
      const rawModeName = formatClashBattleMode(battle);
      modeBadge.setAttribute("aria-label", `${mode.label} mode: ${rawModeName}`);
      modeHint.attach(modeBadge, rawModeName);
      details.append(
        modeBadge,
        createElement("strong", "cr-battle-opponent", formatMatchup(resolvedBattle)),
        createBattleTime(battle.battleTime)
      );
      info.appendChild(details);
      summary.appendChild(info);

      const metrics = createElement("span", "cr-battle-metrics");
      if (hasCrowns) {
        const playerCrowns = Math.trunc(player.crowns);
        const opponentCrowns = Math.trunc(opponent.crowns);
        metrics.appendChild(
          createBattleMetric({
            accessibleText: `${playerCrowns} to ${opponentCrowns} crowns`,
            icon: CROWN_ICON,
            value: `${playerCrowns}-${opponentCrowns}`,
            minimumLength: 3,
          })
        );
      } else {
        metrics.appendChild(createElement("span", "cr-battle-metric cr-battle-metric--unknown", "Crowns unavailable"));
      }
      if (typeof player.trophyChange === "number" && Number.isFinite(player.trophyChange)) {
        const trophyChange = Math.trunc(player.trophyChange);
        metrics.appendChild(
          createBattleMetric({
            accessibleText: `${trophyChange > 0 ? "+" : ""}${trophyChange} trophies`,
            icon: TROPHY_ICON,
            sign: trophyChange > 0 ? "+" : "",
            value: String(trophyChange),
            minimumLength: 2,
          })
        );
      }
      summary.appendChild(metrics);
      item.appendChild(summary);
      const participantDecks = createParticipantDecks(resolvedBattle);
      if (participantDecks) item.appendChild(participantDecks);
      return item;
    });
    elements.battleLog.replaceChildren(...items);
    elements.battleScroll.scrollTop = 0;
  };

  const renderPlayer = (snapshot) => {
    const { player } = snapshot;
    const profileUrl = royaleApiProfileUrl(snapshot.playerTag);
    elements.playerName.textContent = String(player.name ?? "Unnamed player").trim() || "Unnamed player";
    elements.playerTag.textContent = `#${snapshot.playerTag}`;
    elements.profileLink.href = profileUrl;
    renderDigitValue(elements.trophies, player.trophies, 4);
    renderDigitValue(elements.bestTrophies, player.bestTrophies, 4);
    elements.arena.textContent = String(player.arena?.name ?? "Unavailable").trim() || "Unavailable";
    elements.clan.textContent = formatClan(player.clan);

    if (isFiniteNonnegative(player.wins) && isFiniteNonnegative(player.losses)) {
      elements.careerRecord.replaceChildren(
        createElement("span", "cr-career-wins", `${Math.trunc(player.wins).toLocaleString()} wins`),
        createElement("span", "cr-career-separator", " · "),
        createElement("span", "cr-career-losses", `${Math.trunc(player.losses).toLocaleString()} losses`)
      );
    } else {
      elements.careerRecord.textContent = EMPTY_VALUE;
    }
    elements.careerWinRate.textContent = formatWinRate(player.wins, player.losses);
    renderDigitValue(elements.battleCount, player.battleCount, 4);
    renderDigitValue(elements.threeCrownWins, player.threeCrownWins, 3);
    elements.lastUpdated.textContent = snapshot.fetchedAt.toLocaleString();
    elements.lastUpdated.dateTime = snapshot.fetchedAt.toISOString();
    return profileUrl;
  };

  const renderHistoryFooter = (battleCount, profileUrl) => {
    const link = createElement("a", "", "Royale API");
    link.href = profileUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    elements.historyFooter.replaceChildren(formatHistoryPrefix(battleCount), link, " for full list.");
  };

  const renderSnapshot = (snapshot) => {
    const profileUrl = renderPlayer(snapshot);
    renderDeck(snapshot.currentDeck);
    renderBattles(snapshot.battles);
    elements.sampleSummary.textContent = formatSampleSummary(summarizeClashBattles(snapshot.battles));
    renderHistoryFooter(snapshot.battles.length, profileUrl);
  };

  const requestSnapshot = async (controller) => {
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, CLASH_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(buildClashSnapshotUrl(settings.proxyBaseUrl, settings.playerTag), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await readResponseJson(response);
      if (!response.ok || payload?.ok !== true) {
        const error = new Error("Clash Royale endpoint failed");
        error.userMessage = errorMessageFor(response.status, payload);
        throw error;
      }
      return prepareClashSnapshot(payload, settings.playerTag);
    } catch (error) {
      if (controller.signal.reason?.name === "TimeoutError") {
        const timeoutError = new Error("Clash Royale request timed out");
        timeoutError.userMessage = "The player data request timed out. Try again.";
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const load = (force = false) => {
    if (!settings.proxyBaseUrl) return Promise.resolve();
    if (activeRequest) return activeRequest.promise;
    if (hasSnapshot && !force) return Promise.resolve();

    setLoading(true);
    setStatus(hasSnapshot ? "Refreshing player data…" : "Loading player data…", "loading");
    const request = { controller: new AbortController(), promise: null };
    request.promise = requestSnapshot(request.controller)
      .then((snapshot) => {
        if (activeRequest !== request) return;
        renderSnapshot(snapshot);
        hasSnapshot = true;
        setStatus(formatLoadedStatus(snapshot.battles.length), "success");
      })
      .catch((error) => {
        if (activeRequest !== request) return;
        if (error?.name === "AbortError") return;
        setStatus(error?.userMessage ?? "Player data could not be loaded. Try again.", "error");
      })
      .finally(() => {
        if (activeRequest !== request) return;
        activeRequest = null;
        setLoading(false);
      });
    activeRequest = request;
    return request.promise;
  };

  const cancel = () => {
    modeHint.hide();
    const request = activeRequest;
    activeRequest = null;
    request?.controller.abort(new DOMException("Window closed", "AbortError"));
    if (!settings.proxyBaseUrl) return;
    setStatus(hasSnapshot ? "Showing the last loaded player data." : "Refresh cancelled.");
    setLoading(false);
  };

  if (settings.proxyBaseUrl) {
    elements.refresh.addEventListener("click", () => load(true));
  } else {
    elements.refresh.disabled = true;
    body.classList.add("is-unconfigured");
  }
  win.clashRoyale = Object.freeze({ cancel, load });
};

export default {
  id: "clash-royale",
  title: "Clash Royale Stats",
  icon: "assets/app-icons/ico/game_freecell.ico",
  styles: ["apps/clash-royale/clash-royale.css"],
  window: {
    className: "clash-royale-window",
    bodyClassName: "clash-royale-window-body",
    controls: ["close"],
    center: true,
    dialog: true,
  },
  render,
  mount,
  onOpen(win) {
    win.clashRoyale.load(false);
  },
  onClose(win) {
    win.clashRoyale.cancel();
  },
};
