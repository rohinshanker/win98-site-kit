// Solitaire: draw-one Klondike with solver-verified winnable deals, click
// moves, undo, an animated auto-solve, fireworks and a victory video. The
// rules live in rules.js; this module owns the cards on screen, the
// animations and the toolbar.

import { clampIntoViewport, flashBanner, loadDeferredMedia, openWindow, prefersReducedMotion } from "../../kit/index.js";
import * as rules from "./rules.js";
import { formatSevenSegmentCounter, setSevenSegmentCounter } from "./seven-segment.js";

const DOUBLE_CLICK_WINDOW_MS = 500;
const FIREWORK_BURST_COUNT = 9;
const FIREWORK_BURST_INTERVAL_MS = 260;
const FIREWORK_DURATION_MS = 3600;
const FIREWORK_PARTICLES = 46;
/** One interactive move costs a handful of primitive steps; this is generous. */
const MOVE_WORK = 1024;
const IMPACT_SOUND_SOURCE = "assets/solitaire/hero-parry.mp3";
const IMPACT_SOUND_POOL_SIZE = 4;
const RULES_LINK = "https://en.wikipedia.org/wiki/Klondike_(solitaire)";

const FIREWORK_COLORS = ["#ff004d", "#ffa300", "#fff024", "#00e756", "#29adff", "#83769c", "#ff77a8", "#ffffff"];

const SUIT_DATA = {
  spades: { symbol: "♠", label: "Spades" },
  clubs: { symbol: "♣", label: "Clubs" },
  diamonds: { symbol: "♦", label: "Diamonds" },
  hearts: { symbol: "♥", label: "Hearts" },
};

const RANK_NAMES = {
  1: "Ace",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
  11: "Jack",
  12: "Queen",
  13: "King",
};

/** The card sprite sheet: 13 ranks across, the four suits and the back below. */
const SPRITE = { cardHeight: 22, imageHeight: 114, backCol: 10, backRow: 4 };

const cardName = (card) => `${RANK_NAMES[card.rank]} of ${SUIT_DATA[card.suit].label}`;

const cardShortName = (card) => {
  const rank = { 1: "A", 11: "J", 12: "Q", 13: "K" }[card.rank] || card.rank;
  return `${rank} ${SUIT_DATA[card.suit].symbol}`;
};

const spritePosition = (col, row) => {
  const x = col === 0 ? 0 : (col / 12) * 100;
  const yDenominator = SPRITE.imageHeight - SPRITE.cardHeight;
  const y = row === 0 ? 0 : ((row * SPRITE.cardHeight) / yDenominator) * 100;
  return { x: `${x.toFixed(4)}%`, y: `${y.toFixed(4)}%` };
};

const applyCardSprite = (element, col, row) => {
  const position = spritePosition(col, row);
  element.style.setProperty("--sol-sprite-x", position.x);
  element.style.setProperty("--sol-sprite-y", position.y);
};

const applyFaceSprite = (element, card) => applyCardSprite(element, card.rank - 1, rules.SUITS.indexOf(card.suit));

const setAttribute = (element, name, value) => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const setText = (element, text) => {
  if (element.textContent !== text) element.textContent = text;
};

/**
 * Makes `nodes` the children of `parent`, in order, by moving the nodes that
 * are already there instead of rebuilding them, so cards keep their identity,
 * focus and running animations wherever the data behind them is unchanged.
 */
const syncChildren = (parent, nodes) => {
  let cursor = parent.firstChild;
  nodes.forEach((node) => {
    if (cursor === node) {
      cursor = cursor.nextSibling;
      return;
    }
    parent.insertBefore(node, cursor);
  });
  while (cursor) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
};

const cardElementsById = (parent) => {
  const elements = new Map();
  Array.from(parent.children).forEach((child) => {
    const id = child.getAttribute("data-sol-card-id");
    if (id) elements.set(id, child);
  });
  return elements;
};

const digitHtml = () =>
  Array.from({ length: 3 }, () => `<img class="sol-digit" src="assets/solitaire/digits/digital_0.png" alt="0" />`).join("");

const foundationSlotHtml = (suit) =>
  `<div class="sol-slot" data-sol-foundation="${suit}" role="button" tabindex="0" aria-label="${SUIT_DATA[suit].label} foundation"></div>`;

const bodyHtml = () => `
  <div class="sol-app" aria-label="Solitaire game">
    <div class="sol-toolbar">
      <button class="sol-reset" type="button" aria-label="Reset game" title="Reset game">
        <img data-src="assets/solitaire/reset-button.png" alt="" />
      </button>
      <button class="sol-auto-solve" type="button" aria-label="Auto-solve game" title="Auto-solve game" hidden>
        <img data-src="assets/app-icons/ico/check.ico" width="22" height="22" alt="" />
      </button>
      <div class="sol-counter" aria-label="Solitaire moves">${digitHtml()}</div>
      <button class="sol-undo" type="button" aria-label="Undo move" title="Undo move" disabled>
        <img data-src="assets/solitaire/undo-button.png" alt="" />
      </button>
    </div>
    <div class="sol-board" aria-label="Solitaire board">
      <div class="sol-top-row">
        <div class="sol-slot sol-stock" role="button" tabindex="0" data-sol-stock aria-label="Stock"></div>
        <div class="sol-slot sol-waste" aria-label="Waste"></div>
        <div class="sol-spacer" aria-hidden="true"></div>
        ${rules.SUITS.map(foundationSlotHtml).join("")}
      </div>
      <div class="sol-tableau" aria-label="Tableau"></div>
    </div>
    <div class="sol-victory-video-overlay" aria-hidden="true">
      <video class="sol-victory-video" data-src="assets/solitaire/victory-royale.webm" data-unload-on-hide preload="none" playsinline></video>
      <canvas class="sol-victory-canvas" aria-hidden="true"></canvas>
    </div>
  </div>`;

const rulesHtml = () => `
  <ol class="sol-rules-list">
    <li>Move all 52 cards to the four foundation piles to win.</li>
    <li>Every new deal is a random shuffle that a built-in solver has checked for at least one winning path with draw-one stock and unlimited redeals.</li>
    <li>Foundations build upward by suit from Ace to King.</li>
    <li>Tableau columns build downward by rank and must alternate red and black cards.</li>
    <li>Only face-up cards can move.</li>
    <li>A face-up tableau stack can move only when every card in the stack is already in descending alternating order.</li>
    <li>Empty tableau columns can only receive a King or a valid stack that starts with a King.</li>
    <li>Click the stock to draw one card to the waste pile.</li>
    <li>Only the top waste card can move to a tableau column or foundation.</li>
    <li>The top card of a foundation can move back to the tableau if it fits.</li>
    <li>When the stock is empty, click it to turn the waste pile back into the stock. You can redeal as often as needed.</li>
    <li>When a face-down tableau card is uncovered, it turns face up.</li>
  </ol>`;

const bodyOverlay = (className) => {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  document.body.appendChild(element);
  return element;
};

/** Wires one Solitaire window. Everything the game owns lives in this closure. */
const createSolitaire = (win) => {
  const board = win.querySelector(".sol-board");
  const stockSlot = win.querySelector(".sol-stock");
  const wasteSlot = win.querySelector(".sol-waste");
  const tableauEl = win.querySelector(".sol-tableau");
  const foundationSlots = Array.from(win.querySelectorAll("[data-sol-foundation]"));
  const movesCounter = win.querySelector(".sol-counter");
  const resetButton = win.querySelector(".sol-reset");
  const undoButton = win.querySelector(".sol-undo");
  const autoSolveButton = win.querySelector(".sol-auto-solve");
  const victoryOverlay = win.querySelector(".sol-victory-video-overlay");
  const victoryVideo = win.querySelector(".sol-victory-video");
  const victoryCanvas = win.querySelector(".sol-victory-canvas");
  const fireworks = bodyOverlay("sol-fireworks");
  const achievement = bodyOverlay("sol-achievement");
  achievement.innerHTML = '<img src="assets/solitaire/achievement.png" alt="Achievement unlocked" />';

  /** The cards as drawn: a projection of `game` (see rules.toBoard). */
  const state = {
    stock: [],
    waste: [],
    foundations: { spades: [], clubs: [], diamonds: [], hearts: [] },
    tableau: [],
    selected: null,
    moves: 0,
    won: false,
  };

  /** The engine state; every move goes through it and `state` is rewritten from it. */
  let game = null;
  let boardReady = false;
  let lastCardClick = null;
  let autoSolveRun = null;
  let windowImpact = null;
  let planCache = null;
  let activeTooltip = null;
  let fireworkTimeout = null;
  let fireworkTimers = [];
  let victoryFrameRequest = null;
  let victoryScratchCanvas = null;
  let impactSoundPool = [];
  let impactSoundIndex = 0;
  let stockBack = null;
  const slotMarks = new Map();
  const tableauColumns = [];

  // ---------------------------------------------------------------- engine

  const projectEngineGame = () => {
    const projected = rules.toBoard(game);
    state.stock = projected.stock;
    state.waste = projected.waste;
    state.foundations = projected.foundations;
    state.tableau = projected.tableau;
    state.moves = projected.moves;
    state.won = projected.won;
  };

  /** Plays one move; the engine decides legality. Returns false when unavailable. */
  const play = (action, { render: shouldRender = true } = {}) => {
    if (!rules.canApply(game, action)) return false;
    const wasWon = game.won;
    rules.transition(game, action, rules.createBudget(MOVE_WORK));
    projectEngineGame();
    state.selected = null;
    checkWin(wasWon);
    if (shouldRender) render();
    return true;
  };

  const canUndo = () => game.undo.length > 0;

  const boardSignature = () => {
    const pile = (cards) => cards.map((card) => `${card.id}${card.faceUp ? ">" : "<"}`).join(",");
    return [
      state.won ? "won" : "live",
      pile(state.stock),
      rules.SUITS.map((suit) => state.foundations[suit].length).join(","),
      pile(state.waste),
      ...state.tableau.map(pile),
    ].join("|");
  };

  /** `planAutoSolveBoard`, recomputed only when the board can have changed. */
  const autoSolvePlan = () => {
    const signature = boardSignature();
    if (planCache?.signature === signature) return planCache.plan;
    const plan = rules.planAutoSolveBoard(state);
    planCache = { signature, plan };
    return plan;
  };

  const canAutoSolve = () => !state.won && autoSolvePlan().moves.length > 0;

  // --------------------------------------------------------------- tooltip

  const hideTooltip = () => {
    if (!activeTooltip) return;
    activeTooltip.classList.remove("is-visible");
    activeTooltip = null;
  };

  const positionTooltip = (tooltip, pointer) => {
    const offset = 12;
    const minEdge = 4;
    tooltip.style.left = `${pointer.clientX + offset}px`;
    tooltip.style.top = `${pointer.clientY + offset}px`;
    if (!tooltip.classList.contains("is-visible")) return;
    const bounds = tooltip.getBoundingClientRect();
    const left = Math.min(pointer.clientX + offset, window.innerWidth - bounds.width - minEdge);
    const top = Math.min(pointer.clientY + offset, window.innerHeight - bounds.height - minEdge);
    tooltip.style.left = `${Math.max(minEdge, left)}px`;
    tooltip.style.top = `${Math.max(minEdge, top)}px`;
  };

  const attachTooltip = (columnEl, tooltip) => {
    const updatePointer = (event) => {
      const card = event.target.closest(".sol-card:not(.is-face-down)");
      if (!card || !columnEl.contains(card)) {
        if (activeTooltip === tooltip) hideTooltip();
        return;
      }
      if (activeTooltip !== tooltip) {
        hideTooltip();
        activeTooltip = tooltip;
        tooltip.classList.add("is-visible");
      }
      positionTooltip(tooltip, { clientX: event.clientX, clientY: event.clientY });
    };
    columnEl.addEventListener("pointerenter", updatePointer);
    columnEl.addEventListener("pointermove", updatePointer);
    columnEl.addEventListener("pointerleave", () => {
      if (activeTooltip === tooltip) hideTooltip();
    });
  };

  // --------------------------------------------------------------- victory

  const hideVictoryVideo = () => {
    if (victoryFrameRequest) {
      cancelAnimationFrame(victoryFrameRequest);
      victoryFrameRequest = null;
    }
    victoryOverlay.classList.remove("is-showing");
    victoryOverlay.setAttribute("aria-hidden", "true");
    victoryVideo.classList.remove("is-visible-fallback");
    victoryCanvas.classList.remove("is-hidden");
    const context = victoryCanvas.getContext("2d");
    if (context) context.clearRect(0, 0, victoryCanvas.width, victoryCanvas.height);
    victoryVideo.pause();
    try {
      victoryVideo.currentTime = 0;
    } catch {
      // Seeking waits for metadata in some browsers; the next play reloads anyway.
    }
  };

  /** Keys the video's black background out onto the canvas, cropped to the subject. */
  const drawVictoryFrame = () => {
    victoryFrameRequest = null;
    if (!victoryOverlay.classList.contains("is-showing")) return;
    const sourceWidth = victoryVideo.videoWidth;
    const sourceHeight = victoryVideo.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      if (!victoryVideo.paused && !victoryVideo.ended) victoryFrameRequest = requestAnimationFrame(drawVictoryFrame);
      return;
    }
    const width = Math.min(sourceWidth, 960);
    const height = Math.round((sourceHeight / sourceWidth) * width);
    if (!victoryScratchCanvas) victoryScratchCanvas = document.createElement("canvas");
    if (victoryScratchCanvas.width !== width || victoryScratchCanvas.height !== height) {
      victoryScratchCanvas.width = width;
      victoryScratchCanvas.height = height;
    }
    const scratch = victoryScratchCanvas.getContext("2d", { willReadFrequently: true });
    if (!scratch) return;
    try {
      scratch.clearRect(0, 0, width, height);
      scratch.drawImage(victoryVideo, 0, 0, width, height);
      const frame = scratch.getImageData(0, 0, width, height);
      const pixels = frame.data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < pixels.length; i += 4) {
        const brightest = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (brightest < 32) pixels[i + 3] = 0;
        else if (brightest < 72) pixels[i + 3] = Math.round(pixels[i + 3] * ((brightest - 32) / 40));
        if (pixels[i + 3] > 8) {
          const pixelIndex = i / 4;
          const x = pixelIndex % width;
          const y = Math.floor(pixelIndex / width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      const context = victoryCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      if (maxX < minX || maxY < minY) {
        context.clearRect(0, 0, victoryCanvas.width, victoryCanvas.height);
        return;
      }
      const cropPadding = Math.max(6, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.04));
      const cropX = Math.max(0, minX - cropPadding);
      const cropY = Math.max(0, minY - cropPadding);
      const cropRight = Math.min(width - 1, maxX + cropPadding);
      const cropBottom = Math.min(height - 1, maxY + cropPadding);
      const cropWidth = cropRight - cropX + 1;
      const cropHeight = cropBottom - cropY + 1;
      if (victoryCanvas.width !== cropWidth || victoryCanvas.height !== cropHeight) {
        victoryCanvas.width = cropWidth;
        victoryCanvas.height = cropHeight;
      }
      const cropped = context.createImageData(cropWidth, cropHeight);
      for (let y = 0; y < cropHeight; y += 1) {
        const sourceStart = ((cropY + y) * width + cropX) * 4;
        cropped.data.set(pixels.subarray(sourceStart, sourceStart + cropWidth * 4), y * cropWidth * 4);
      }
      context.putImageData(cropped, 0, 0);
    } catch {
      // A tainted or unreadable frame: show the video itself instead of the canvas.
      victoryCanvas.classList.add("is-hidden");
      victoryVideo.classList.add("is-visible-fallback");
      return;
    }
    if (!victoryVideo.paused && !victoryVideo.ended) victoryFrameRequest = requestAnimationFrame(drawVictoryFrame);
  };

  const startVictoryCanvas = () => {
    if (victoryFrameRequest) cancelAnimationFrame(victoryFrameRequest);
    victoryFrameRequest = requestAnimationFrame(drawVictoryFrame);
  };

  const playVictoryVideo = () => {
    loadDeferredMedia(victoryOverlay);
    victoryOverlay.classList.add("is-showing");
    victoryOverlay.setAttribute("aria-hidden", "false");
    victoryVideo.classList.remove("is-visible-fallback");
    victoryCanvas.classList.remove("is-hidden");
    victoryVideo.pause();
    victoryVideo.muted = false;
    victoryVideo.volume = 1;
    try {
      victoryVideo.currentTime = 0;
    } catch {
      victoryVideo.load();
    }
    startVictoryCanvas();
    const request = victoryVideo.play();
    if (request && typeof request.catch === "function") request.then(startVictoryCanvas).catch(() => {});
  };

  const createFireworkBurst = (x, y) => {
    for (let i = 0; i < FIREWORK_PARTICLES; i += 1) {
      const dot = document.createElement("span");
      const angle = (Math.PI * 2 * i) / FIREWORK_PARTICLES + Math.random() * 0.22;
      const distance = 60 + Math.random() * 155;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance + 38;
      dot.className = "sol-firework-dot";
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.setProperty("--sol-firework-dx", `${dx.toFixed(1)}px`);
      dot.style.setProperty("--sol-firework-dy", `${dy.toFixed(1)}px`);
      dot.style.setProperty("--sol-firework-color", FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]);
      fireworks.appendChild(dot);
    }
  };

  const startFireworks = () => {
    fireworkTimers.forEach((timer) => clearTimeout(timer));
    fireworkTimers = [];
    if (fireworkTimeout) clearTimeout(fireworkTimeout);
    fireworks.innerHTML = "";
    fireworks.classList.add("is-showing");
    fireworks.setAttribute("aria-hidden", "false");
    for (let i = 0; i < FIREWORK_BURST_COUNT; i += 1) {
      fireworkTimers.push(
        setTimeout(() => {
          createFireworkBurst(
            window.innerWidth * (0.18 + Math.random() * 0.64),
            window.innerHeight * (0.16 + Math.random() * 0.42)
          );
        }, i * FIREWORK_BURST_INTERVAL_MS)
      );
    }
    fireworkTimeout = setTimeout(() => {
      fireworks.classList.remove("is-showing");
      fireworks.setAttribute("aria-hidden", "true");
      fireworks.innerHTML = "";
      fireworkTimers = [];
      fireworkTimeout = null;
    }, FIREWORK_DURATION_MS);
  };

  const triggerVictoryEffects = () => {
    startFireworks();
    flashBanner(achievement);
    playVictoryVideo();
  };

  /** Announces a victory the moment one happens, and only then. */
  const checkWin = (wasWon = state.won) => {
    const placed = rules.SUITS.reduce((total, suit) => total + state.foundations[suit].length, 0);
    state.won = placed === rules.DECK_SIZE;
    if (!wasWon && state.won) triggerVictoryEffects();
  };

  // ---------------------------------------------------------------- render

  const slotMark = (key, text) => {
    const existing = slotMarks.get(key);
    if (existing) {
      setText(existing, text);
      return existing;
    }
    const mark = document.createElement("span");
    mark.className = "sol-slot-mark";
    mark.textContent = text;
    slotMarks.set(key, mark);
    return mark;
  };

  const isSelectedCard = (card) =>
    Boolean(state.selected && state.selected.cards.some((selected) => selected.id === card.id));

  const updateCardElement = (button, card, zone, pile, index) => {
    setAttribute(button, "data-sol-zone", zone);
    setAttribute(button, "data-sol-pile", String(pile));
    setAttribute(button, "data-sol-index", String(index));
    // A cancelled run leaves its lifted source card on the board; clear it here.
    button.classList.remove("is-auto-solve-lifted");
    button.classList.toggle("is-face-down", !card.faceUp);
    if (!card.faceUp) {
      button.classList.remove("is-selected");
      applyCardSprite(button, SPRITE.backCol, SPRITE.backRow);
      setAttribute(button, "aria-label", "Face-down card");
      return button;
    }
    button.classList.toggle("is-selected", isSelectedCard(card));
    applyFaceSprite(button, card);
    setAttribute(button, "aria-label", cardName(card));
    return button;
  };

  const cardElement = (existing, card, zone, pile, index) => {
    let button = existing.get(card.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "sol-card";
      button.setAttribute("data-sol-card-id", card.id);
    }
    return updateCardElement(button, card, zone, pile, index);
  };

  const stockBackElement = () => {
    if (stockBack) return stockBack;
    stockBack = document.createElement("button");
    stockBack.type = "button";
    stockBack.className = "sol-card is-face-down";
    stockBack.setAttribute("data-sol-stock", "");
    applyCardSprite(stockBack, SPRITE.backCol, SPRITE.backRow);
    return stockBack;
  };

  const foundationSlot = (suit) => foundationSlots.find((slot) => slot.getAttribute("data-sol-foundation") === suit);

  const renderFoundationSlot = (slot, suit) => {
    const pile = state.foundations[suit];
    const topCard = pile[pile.length - 1];
    syncChildren(slot, [
      topCard
        ? cardElement(cardElementsById(slot), topCard, "foundation", suit, pile.length - 1)
        : slotMark(`foundation-${suit}`, SUIT_DATA[suit].symbol),
    ]);
    setAttribute(
      slot,
      "aria-label",
      topCard ? `${SUIT_DATA[suit].label} foundation, ${cardName(topCard)}` : `${SUIT_DATA[suit].label} foundation`
    );
  };

  const renderStock = () => {
    const label = state.stock.length
      ? `Stock, ${state.stock.length} cards`
      : state.waste.length
        ? "Restock waste"
        : "Empty stock";
    if (state.stock.length) {
      const back = stockBackElement();
      setAttribute(back, "aria-label", label);
      syncChildren(stockSlot, [back]);
    } else {
      syncChildren(stockSlot, state.waste.length ? [slotMark("stock", "↻")] : []);
    }
    setAttribute(stockSlot, "aria-label", label);
  };

  const renderWaste = () => {
    const topCard = state.waste[state.waste.length - 1];
    syncChildren(wasteSlot, [
      topCard
        ? cardElement(cardElementsById(wasteSlot), topCard, "waste", "waste", state.waste.length - 1)
        : slotMark("waste", "W"),
    ]);
    setAttribute(wasteSlot, "aria-label", topCard ? `Waste, ${cardName(topCard)}` : "Waste");
  };

  /** Each column, its empty slot and its body-level tooltip are built once. */
  const tableauColumn = (colIndex) => {
    if (tableauColumns[colIndex]) return tableauColumns[colIndex];
    const columnEl = document.createElement("div");
    columnEl.className = "sol-tableau-col";
    columnEl.setAttribute("data-sol-col", String(colIndex));
    columnEl.setAttribute("role", "button");
    columnEl.setAttribute("tabindex", "0");
    const emptySlot = document.createElement("div");
    emptySlot.className = "sol-slot";
    emptySlot.setAttribute("aria-hidden", "true");
    const tooltip = document.createElement("span");
    tooltip.className = "sol-tableau-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
    attachTooltip(columnEl, tooltip);
    const column = { columnEl, emptySlot, tooltip };
    tableauColumns[colIndex] = column;
    return column;
  };

  const renderTableauColumn = (cards, colIndex) => {
    const { columnEl, emptySlot, tooltip } = tableauColumn(colIndex);
    const existing = cardElementsById(columnEl);
    syncChildren(
      columnEl,
      cards.length ? cards.map((card, cardIndex) => cardElement(existing, card, "tableau", colIndex, cardIndex)) : [emptySlot]
    );
    const bottomCard = cards.find((card) => card.faceUp);
    if (bottomCard) {
      setText(tooltip, `Bottom: ${cardShortName(bottomCard)}`);
      setAttribute(columnEl, "aria-label", `Tableau column ${colIndex + 1}, bottom card ${cardName(bottomCard)}`);
    } else {
      setText(tooltip, "");
      if (activeTooltip === tooltip) hideTooltip();
      setAttribute(columnEl, "aria-label", `Tableau column ${colIndex + 1}`);
    }
    return columnEl;
  };

  const renderCounter = () => setSevenSegmentCounter(movesCounter, formatSevenSegmentCounter(state.moves));

  const renderToolbar = () => {
    const solving = Boolean(autoSolveRun);
    const showAutoSolve = solving || canAutoSolve();
    const completes = showAutoSolve && (solving ? autoSolveRun.completes : autoSolvePlan().completes);
    resetButton.hidden = showAutoSolve;
    autoSolveButton.hidden = !showAutoSolve;
    autoSolveButton.disabled = solving;
    autoSolveButton.classList.toggle("is-completing", completes);
    setAttribute(autoSolveButton, "aria-label", completes ? "Auto-solve and win the game" : "Auto-solve visible cards");
    undoButton.disabled = solving || state.won || !canUndo();
  };

  const render = () => {
    renderStock();
    renderWaste();
    foundationSlots.forEach((slot) => renderFoundationSlot(slot, slot.getAttribute("data-sol-foundation")));
    syncChildren(
      tableauEl,
      state.tableau.map((column, colIndex) => renderTableauColumn(column, colIndex))
    );
    renderCounter();
    renderToolbar();
  };

  // ------------------------------------------------------------ auto-solve

  const boardRelativeRect = (element) => {
    const boardRect = board.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - boardRect.left + board.scrollLeft,
      top: rect.top - boardRect.top + board.scrollTop,
      width: rect.width,
      height: rect.height,
    };
  };

  const autoSolveSourceElement = (move, card) =>
    move.zone === "tableau"
      ? tableauEl.querySelector(`[data-sol-col="${move.pile}"] [data-sol-card-id="${card.id}"]`)
      : wasteSlot.querySelector(`[data-sol-card-id="${card.id}"]`);

  const createFlyingCard = (card, from) => {
    const flyer = document.createElement("span");
    flyer.className = "sol-card sol-flying-card";
    flyer.setAttribute("aria-hidden", "true");
    flyer.style.left = `${from.left}px`;
    flyer.style.top = `${from.top}px`;
    applyFaceSprite(flyer, card);
    return flyer;
  };

  /** Slow rise with a drop-shadow lift, then an ease-in snap onto the foundation. */
  const animateFlight = (flyer, { dx, dy, liftMs, snapMs, height }) => {
    const landed = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    if (typeof flyer.animate !== "function") {
      flyer.style.translate = landed;
      return;
    }
    const liftY = -Math.max(8, Math.round(height * 0.14));
    const grounded = "drop-shadow(0 0 0 rgba(0, 0, 0, 0))";
    const lifted = "drop-shadow(0 14px 10px rgba(0, 0, 0, 0.45))";
    flyer.animate(
      [
        { translate: "0 0", scale: "1", filter: grounded, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
        {
          translate: `0 ${liftY}px`,
          scale: "1.07",
          filter: lifted,
          offset: liftMs / (liftMs + snapMs),
          easing: "cubic-bezier(0.6, 0, 1, 0.4)",
        },
        { translate: landed, scale: "1", filter: grounded },
      ],
      { duration: liftMs + snapMs, fill: "forwards" }
    );
  };

  const prepareImpactSound = () => {
    if (impactSoundPool.length || typeof Audio !== "function") return;
    impactSoundPool = Array.from({ length: IMPACT_SOUND_POOL_SIZE }, () => {
      const audio = new Audio(IMPACT_SOUND_SOURCE);
      audio.preload = "auto";
      audio.load();
      return audio;
    });
  };

  const playImpactSound = () => {
    prepareImpactSound();
    const audio = impactSoundPool[impactSoundIndex];
    if (!audio) return;
    impactSoundIndex = (impactSoundIndex + 1) % impactSoundPool.length;
    try {
      audio.currentTime = 0;
    } catch {
      // Seeking before metadata is ready is harmless; play still starts at 0.
    }
    const request = audio.play();
    if (request && typeof request.catch === "function") request.catch(() => {});
  };

  const flashFoundation = (suit) => {
    const slot = foundationSlot(suit);
    if (!slot) return;
    const rect = boardRelativeRect(slot);
    const flash = document.createElement("span");
    flash.className = "sol-foundation-flash";
    flash.setAttribute("aria-hidden", "true");
    flash.style.left = `${rect.left}px`;
    flash.style.top = `${rect.top}px`;
    flash.style.width = `${rect.width}px`;
    flash.style.height = `${rect.height}px`;
    const remove = () => flash.remove();
    flash.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 600);
    board.appendChild(flash);
  };

  const cancelWindowImpact = () => {
    if (!windowImpact) return;
    windowImpact.cancel();
    windowImpact = null;
  };

  /** Knocks the window 12px along the card's travel with a short rebound. */
  const impactWindow = (dx, dy) => {
    if (typeof win.animate !== "function" || prefersReducedMotion()) return;
    const length = Math.hypot(dx, dy) || 1;
    const push = 12;
    const pushX = (dx / length) * push;
    const pushY = (dy / length) * push;
    const shift = (x, y) => `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    cancelWindowImpact();
    windowImpact = win.animate(
      [
        { translate: shift(0, 0) },
        { translate: shift(pushX, pushY), offset: 0.22 },
        { translate: shift(-pushX * 0.35, -pushY * 0.35), offset: 0.62 },
        { translate: shift(0, 0) },
      ],
      { duration: 280, easing: "ease-out", composite: "add" }
    );
    windowImpact.addEventListener("finish", () => {
      if (windowImpact?.playState === "finished") windowImpact = null;
    });
  };

  /** Updates only the source card and destination pile; a full render when more changed. */
  const renderLanding = (move, card, flipped) => {
    const column = move.zone === "tableau" ? state.tableau[move.pile] : null;
    const columnEl = column && tableauEl.querySelector(`[data-sol-col="${move.pile}"]`);
    const cardEl = columnEl?.querySelector(`[data-sol-card-id="${card.id}"]`);
    const slot = foundationSlot(move.suit);
    if (!column?.length || flipped || !cardEl || !slot) {
      render();
      return;
    }
    cardEl.remove();
    renderFoundationSlot(slot, move.suit);
    renderCounter();
    renderToolbar();
  };

  const moveUncoversCard = (move) => {
    if (move.zone !== "tableau") return false;
    const column = state.tableau[move.pile];
    const below = column[column.length - 2];
    return Boolean(below && !below.faceUp);
  };

  const landAutoSolveCard = (run, move, card, flight) => {
    run.flyer?.remove();
    run.flyer = null;
    const flipped = moveUncoversCard(move);
    play(move.action, { render: false });
    renderLanding(move, card, flipped);
    flashFoundation(move.suit);
    playImpactSound();
    impactWindow(flight.dx, flight.dy);
  };

  /** Closes the engine's run, so one undo snapshot covers the whole animation. */
  const endAutoRun = () => {
    if (game?.autoRun) play({ op: "autoRunEnd" }, { render: false });
  };

  const finishAutoSolve = (run) => {
    if (run !== autoSolveRun) return;
    autoSolveRun = null;
    board.classList.remove("is-auto-solving");
    endAutoRun();
    checkWin();
    render();
  };

  const runAutoSolveStep = (run) => {
    if (run !== autoSolveRun) return;
    const move = rules.boardFoundationMove(state);
    if (!move) {
      finishAutoSolve(run);
      return;
    }
    const card = move.zone === "tableau" ? state.tableau[move.pile][move.index] : state.waste[move.index];
    const intervalMs = rules.autoSolveIntervalMs(run.step);
    const { liftMs, snapMs } = rules.autoSolvePhaseMs(intervalMs);
    const sourceCard = autoSolveSourceElement(move, card);
    const source = sourceCard || (move.zone === "tableau" ? tableauEl : wasteSlot);
    const target = foundationSlot(move.suit);
    const from = boardRelativeRect(source);
    const to = boardRelativeRect(target || source);
    const flight = { dx: to.left - from.left, dy: to.top - from.top };

    sourceCard?.classList.add("is-auto-solve-lifted");
    run.flyer = createFlyingCard(card, from);
    board.appendChild(run.flyer);
    animateFlight(run.flyer, { ...flight, liftMs, snapMs, height: from.height });

    run.timer = window.setTimeout(() => {
      if (run !== autoSolveRun) return;
      landAutoSolveCard(run, move, card, flight);
      run.step += 1;
      run.timer = window.setTimeout(() => runAutoSolveStep(run), Math.max(0, intervalMs - liftMs - snapMs));
    }, liftMs + snapMs);
  };

  const cancelAutoSolve = () => {
    const run = autoSolveRun;
    if (!run) return;
    autoSolveRun = null;
    window.clearTimeout(run.timer);
    endAutoRun();
    run.flyer?.remove();
    board.querySelectorAll(".sol-flying-card, .sol-foundation-flash").forEach((element) => element.remove());
    board.classList.remove("is-auto-solving");
    cancelWindowImpact();
    render();
  };

  const startAutoSolve = () => {
    if (autoSolveRun || state.won) return false;
    const plan = autoSolvePlan();
    if (!plan.moves.length) return false;
    state.selected = null;
    lastCardClick = null;
    hideTooltip();
    if (!play({ op: "autoRunStart" }, { render: false })) return false;
    prepareImpactSound();
    autoSolveRun = { step: 0, timer: null, flyer: null, completes: plan.completes };
    board.classList.add("is-auto-solving");
    render();
    runAutoSolveStep(autoSolveRun);
    return true;
  };

  // ------------------------------------------------------------- selection

  const selectionMatches = (zone, pile, index) => {
    const selected = state.selected;
    return Boolean(selected && selected.zone === zone && selected.pile === pile && selected.index === index);
  };

  const isPackedTableauStack = (cards) =>
    cards.length > 0 && cards.every((card) => card.faceUp) && rules.isPackedRun(cards.map((card) => card.id));

  /** The engine action a selected pile-to-pile move stands for, or null. */
  const selectedTableauAction = (colIndex) => {
    const selected = state.selected;
    if (!selected) return null;
    if (selected.zone === "waste") return { op: "wasteToTableau", to: colIndex };
    if (selected.zone === "foundation") return { op: "foundationToTableau", suit: selected.pile, to: colIndex };
    if (selected.zone !== "tableau") return null;
    const faceDown = state.tableau[selected.pile].filter((card) => !card.faceUp).length;
    return { op: "tableauToTableau", from: selected.pile, index: selected.index - faceDown, to: colIndex };
  };

  const selectedFoundationAction = (suit) => {
    const selected = state.selected;
    if (!selected || selected.cards.length !== 1) return null;
    if (selected.cards[0].suit !== suit) return null;
    if (selected.zone === "waste") return { op: "wasteToFoundation" };
    if (selected.zone === "tableau") return { op: "tableauToFoundation", from: selected.pile };
    return null;
  };

  const moveSelectedToTableau = (colIndex) => {
    const selected = state.selected;
    if (!selected) return false;
    if (selected.zone === "tableau" && selected.pile === colIndex) return false;
    const action = selectedTableauAction(colIndex);
    return Boolean(action) && play(action);
  };

  const moveSelectedToFoundation = (suit) => {
    const action = selectedFoundationAction(suit);
    return Boolean(action) && play(action);
  };

  const toggleSelection = (selection) => {
    state.selected = selectionMatches(selection.zone, selection.pile, selection.index) ? null : selection;
    render();
  };

  const selectWaste = () => {
    const index = state.waste.length - 1;
    if (index < 0) return;
    toggleSelection({ zone: "waste", pile: "waste", index, cards: [state.waste[index]] });
  };

  const selectFoundation = (suit, index) => {
    const pile = state.foundations[suit];
    if (index !== pile.length - 1) return;
    toggleSelection({ zone: "foundation", pile: suit, index, cards: [pile[index]] });
  };

  const selectTableau = (colIndex, cardIndex) => {
    const column = state.tableau[colIndex];
    const card = column[cardIndex];
    if (!card || !card.faceUp) return;
    if (state.selected && moveSelectedToTableau(colIndex)) return;
    const cards = column.slice(cardIndex);
    if (!isPackedTableauStack(cards)) return;
    toggleSelection({ zone: "tableau", pile: colIndex, index: cardIndex, cards });
  };

  /** One click draws, or redeals the waste once the stock has run out. */
  const draw = () => {
    state.selected = null;
    if (!play({ op: "draw" }) && !play({ op: "redeal" })) render();
  };

  /** The double-click shortcut: send a visible top card straight to its foundation. */
  const autoMoveCardToFoundation = (zone, pile, index) => {
    const source = zone === "tableau" ? state.tableau[pile] : state.waste;
    if (!source || index !== source.length - 1) return;
    const card = source[index];
    if (!card || !card.faceUp) return;
    const action = zone === "tableau" ? { op: "tableauToFoundation", from: pile } : { op: "wasteToFoundation" };
    if (!play(action)) render();
  };

  const onBoardClick = (event) => {
    if (autoSolveRun || state.won) return;
    const stockHit = event.target.closest("[data-sol-stock]");
    if (stockHit && board.contains(stockHit)) {
      lastCardClick = null;
      draw();
      return;
    }
    const foundationEl = event.target.closest("[data-sol-foundation]");
    const cardEl = event.target.closest("[data-sol-card-id]");
    if (foundationEl && state.selected) {
      if (moveSelectedToFoundation(foundationEl.getAttribute("data-sol-foundation"))) return;
    }
    if (cardEl) {
      const zone = cardEl.getAttribute("data-sol-zone");
      const pileValue = cardEl.getAttribute("data-sol-pile");
      const index = Number(cardEl.getAttribute("data-sol-index"));
      const clickKey = `${zone}:${pileValue}:${index}:${cardEl.getAttribute("data-sol-card-id")}`;
      const clickTime = Date.now();
      if (
        (zone === "waste" || zone === "tableau") &&
        lastCardClick &&
        lastCardClick.key === clickKey &&
        clickTime - lastCardClick.time <= DOUBLE_CLICK_WINDOW_MS
      ) {
        lastCardClick = null;
        autoMoveCardToFoundation(zone, zone === "tableau" ? Number(pileValue) : pileValue, index);
        return;
      }
      lastCardClick = { key: clickKey, time: clickTime };
      if (zone === "waste") selectWaste();
      else if (zone === "foundation") selectFoundation(pileValue, index);
      else if (zone === "tableau") selectTableau(Number(pileValue), index);
      return;
    }
    lastCardClick = null;
    if (foundationEl && state.selected) {
      moveSelectedToFoundation(foundationEl.getAttribute("data-sol-foundation"));
      return;
    }
    const columnEl = event.target.closest("[data-sol-col]");
    if (columnEl && state.selected) moveSelectedToTableau(Number(columnEl.getAttribute("data-sol-col")));
  };

  const onBoardKeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('[role="button"]')) return;
    event.preventDefault();
    target.click();
  };

  // ------------------------------------------------------------------ deals

  const newGame = () => {
    const deal = rules.buildWinnableDeal();
    cancelAutoSolve();
    game = rules.fromBoard({
      stock: deal.stock,
      waste: [],
      foundations: { spades: [], clubs: [], diamonds: [], hearts: [] },
      tableau: deal.tableau,
      moves: 0,
    });
    state.selected = null;
    planCache = null;
    projectEngineGame();
    lastCardClick = null;
    hideVictoryVideo();
    boardReady = true;
    render();
  };

  /** Deals once, on first open, so a reopened window keeps its game. */
  const ensureBoard = () => {
    if (boardReady) return false;
    newGame();
    return true;
  };

  const undo = () => {
    if (state.won) return;
    if (!play({ op: "undo" })) return;
    if (!state.won) hideVictoryVideo();
  };

  board.addEventListener("click", onBoardClick);
  board.addEventListener("keydown", onBoardKeydown);
  resetButton.addEventListener("click", newGame);
  autoSolveButton.addEventListener("click", startAutoSolve);
  undoButton.addEventListener("click", undo);
  victoryVideo.addEventListener("loadeddata", startVictoryCanvas);
  victoryVideo.addEventListener("play", startVictoryCanvas);
  victoryVideo.addEventListener("seeked", startVictoryCanvas);
  victoryVideo.addEventListener("ended", () => {
    victoryVideo.pause();
    drawVictoryFrame();
  });

  return Object.freeze({ cancelAutoSolve, ensureBoard, hideVictoryVideo, hideTooltip });
};

const controllers = new WeakMap();

export default {
  id: "solitaire",
  title: "Solitaire",
  icon: "assets/app-icons/ico/game_solitaire.ico",
  description: "Draw-one Klondike with solver-verified deals, undo and an animated auto-solve.",
  styles: ["apps/solitaire/solitaire.css"],
  window: {
    className: "solitaire-window",
    controls: ["help", "close"],
  },
  render: bodyHtml,
  mount({ window: win }) {
    controllers.set(win, createSolitaire(win));
  },
  onOpen(win) {
    // The first open deals after the window manager has placed an empty
    // window, so the populated board is pulled back into view.
    if (controllers.get(win).ensureBoard()) clampIntoViewport(win);
  },
  onClose(win) {
    const controller = controllers.get(win);
    controller.cancelAutoSolve();
    controller.hideVictoryVideo();
    controller.hideTooltip();
  },
  onHelp() {
    openWindow("solitaire-rules");
  },
  windows: [
    {
      id: "solitaire-rules",
      title: "Solitaire Rules",
      window: { className: "solitaire-rules-window", controls: ["help", "close"] },
      render: rulesHtml,
      onHelp() {
        window.open(RULES_LINK, "_blank", "noopener,noreferrer");
      },
    },
  ],
};
