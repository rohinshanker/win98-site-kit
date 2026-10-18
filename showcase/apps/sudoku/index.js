// Sudoku: a 9x9 puzzle window with off-thread generation, six difficulties,
// pencil marks, hint modes, pause, undo and redo, a clock and local best
// times. rules.js decides every move; this file owns the grid, the aquarium,
// the loader, the clock and the save file.

import {
  afterFrames,
  clamp,
  clampIntoViewport,
  createProgressLoader,
  debounceTimer,
  formatElapsedTime,
  isPageActive,
  isWindowOpen,
  reducedMotionQuery,
  registerKeyHandler,
  storage,
} from "../../kit/index.js";
import * as rules from "./rules.js";
import { showAchievement, startConfetti, startFireworks } from "./effects.js";

const { BLANK, CELL_COUNT, DIGITS, HINT_MODES, STATIC_PUZZLES, GENERATOR_CLUES, GENERATOR_MAX_ATTEMPTS } = rules;

const APP_ID = "sudoku";
const STORAGE_KEY = "win98SiteKit.sudoku.state";
const BEST_TIMES_KEY = "win98SiteKit.sudoku.bestTimes";
const ACHIEVEMENT_IMAGE = "assets/sudoku/achievement.png";
const ROW_COUNT = 9;
const SAVE_DEBOUNCE_MS = 250;
const TIMER_INTERVAL_MS = 1000;
const MAX_FISH = 18;
const MAX_BUBBLE_CLUSTERS = 5;
const NOTE_SHORTCUT_HINT = "Press N to toggle";
// The meter's floor, so the boot screen does not flash past. Past the floor
// the loader waits on the generator instead of on a second timer.
const LOAD_MIN_MS = 1300;
const LOAD_READY_POLL_MS = 90;
const PLAY_BURST_MS = 820;
const POOL_TARGET = 1;
const GENERATING_STATUS = "Generating";

const DIFFICULTY_LABELS = Object.freeze({
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
  master: "Master",
  extreme: "Extreme",
});

const FISH_TYPES = Object.freeze(["clown", "tang", "butterfly", "wrasse"]);

const FISH_DEPTHS = Object.freeze({
  far: {
    size: [16, 28],
    opacity: [0.28, 0.46],
    blur: [0.5, 1.2],
    duration: [18000, 30000],
    school: [3, 7],
    schoolChance: 0.62,
    top: [16, 78],
    saturate: [0.75, 0.95],
  },
  mid: {
    size: [30, 48],
    opacity: [0.5, 0.68],
    blur: [0.12, 0.45],
    duration: [12000, 20000],
    school: [2, 5],
    schoolChance: 0.38,
    top: [20, 82],
    saturate: [0.95, 1.15],
  },
  near: {
    size: [56, 86],
    opacity: [0.72, 0.9],
    blur: [0, 0.12],
    duration: [8500, 14500],
    school: [1, 3],
    schoolChance: 0.18,
    top: [26, 84],
    saturate: [1.05, 1.25],
  },
});

const WIN_EFFECTS = Object.freeze({
  hard: { fireworks: true, confetti: false },
  expert: { fireworks: true, confetti: false },
  master: { fireworks: true, confetti: true },
  extreme: { fireworks: true, confetti: true },
});

const SEABED_MARKUP = `
  <span class="sudoku-coral sudoku-coral--fan sudoku-seabed-item" style="--x: 8%; --bottom: 78px; --scale: 0.82;"></span>
  <span class="sudoku-coral sudoku-coral--branch sudoku-seabed-item" style="--x: 28%; --bottom: 64px; --scale: 0.72;"></span>
  <span class="sudoku-coral sudoku-coral--knob sudoku-seabed-item" style="--x: 43%; --bottom: 17px; --scale: 0.76;"></span>
  <span class="sudoku-coral sudoku-coral--fan sudoku-seabed-item" style="--x: 75%; --bottom: 68px; --scale: 0.68; --coral-opacity: 0.72;"></span>
  <span class="sudoku-coral sudoku-coral--branch sudoku-seabed-item" style="--x: 91%; --bottom: 74px; --scale: 0.9;"></span>
  <span class="sudoku-algae-clump sudoku-seabed-item" style="--x: 16%; --bottom: 58px; --scale: 0.9; --plant-height: 110px; --plant-width: 78px;">
    <span class="sudoku-algae-blade" style="--blade-x: 12%; --blade-width: 8px; --blade-height: 70px; --blade-tilt: -18deg; --sway-time: 4.4s; --sway-delay: -1.2s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 28%; --blade-width: 10px; --blade-height: 96px; --blade-tilt: -8deg; --sway-time: 5.2s; --sway-delay: -2.3s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 48%; --blade-width: 11px; --blade-height: 110px; --blade-tilt: 2deg; --sway-time: 5.8s; --sway-delay: -0.8s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 66%; --blade-width: 9px; --blade-height: 86px; --blade-tilt: 12deg; --sway-time: 4.9s; --sway-delay: -1.8s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 82%; --blade-width: 7px; --blade-height: 62px; --blade-tilt: 22deg; --sway-time: 4.2s; --sway-delay: -0.4s;"></span>
  </span>
  <span class="sudoku-algae-clump sudoku-seabed-item" style="--x: 59%; --bottom: 40px; --scale: 0.72; --plant-height: 86px; --plant-width: 64px;">
    <span class="sudoku-algae-blade" style="--blade-x: 18%; --blade-width: 7px; --blade-height: 50px; --blade-tilt: -20deg; --sway-time: 4.1s; --sway-delay: -1.7s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 38%; --blade-width: 9px; --blade-height: 76px; --blade-tilt: -7deg; --sway-time: 5s; --sway-delay: -0.9s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 58%; --blade-width: 8px; --blade-height: 82px; --blade-tilt: 6deg; --sway-time: 5.4s; --sway-delay: -2.1s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 76%; --blade-width: 7px; --blade-height: 58px; --blade-tilt: 18deg; --sway-time: 4.5s; --sway-delay: -0.3s;"></span>
  </span>
  <span class="sudoku-algae-clump sudoku-seabed-item" style="--x: 84%; --bottom: 56px; --scale: 1; --plant-height: 124px; --plant-width: 82px;">
    <span class="sudoku-algae-blade" style="--blade-x: 10%; --blade-width: 8px; --blade-height: 64px; --blade-tilt: -24deg; --sway-time: 4.3s; --sway-delay: -1.5s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 25%; --blade-width: 9px; --blade-height: 88px; --blade-tilt: -14deg; --sway-time: 5.1s; --sway-delay: -0.7s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 45%; --blade-width: 11px; --blade-height: 122px; --blade-tilt: -1deg; --sway-time: 6s; --sway-delay: -2.5s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 64%; --blade-width: 10px; --blade-height: 104px; --blade-tilt: 10deg; --sway-time: 5.5s; --sway-delay: -1.1s;"></span>
    <span class="sudoku-algae-blade" style="--blade-x: 81%; --blade-width: 8px; --blade-height: 74px; --blade-tilt: 23deg; --sway-time: 4.7s; --sway-delay: -0.5s;"></span>
  </span>`;

const numberButtonsMarkup = () =>
  DIGITS.split("")
    .map(
      (digit) =>
        `<button type="button" data-sudoku-number="${digit}"><span class="sudoku-number-digit">${digit}</span><span class="sudoku-number-remaining" aria-hidden="true"></span></button>`
    )
    .join("");

const difficultyButtonsMarkup = () =>
  rules.DIFFICULTIES.map(
    (difficulty) =>
      `<button type="button" data-sudoku-difficulty="${difficulty}" aria-pressed="false">${DIFFICULTY_LABELS[difficulty]}</button>`
  ).join("");

const render = () => `
  <div class="sudoku-app" aria-label="Sudoku game">
    <div class="sudoku-aero-panel">
      <div class="sudoku-aquarium-layer" id="sudoku-aquarium-layer" aria-hidden="true">
        <div class="sudoku-seabed-layer" aria-hidden="true">${SEABED_MARKUP}</div>
      </div>
      <div class="sudoku-loading-screen" id="sudoku-loading-screen">
        <div class="sudoku-loading-text">
          Loading<span class="sudoku-loading-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </div>
        <div
          class="sudoku-loading-meter"
          id="sudoku-loading-meter"
          role="progressbar"
          aria-label="Sudoku puzzle generation progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
        >
          <span class="sudoku-loading-fill" id="sudoku-loading-fill"></span>
        </div>
        <button class="sudoku-play-button" id="sudoku-play" type="button" aria-label="Play Sudoku" disabled>
          <span class="sudoku-play-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="sudoku-game-content">
        <div class="sudoku-aero-header">
          <span class="sudoku-orb" aria-hidden="true"></span>
          <span class="sudoku-mode-label">Sudoku</span>
        </div>
        <div class="sudoku-board-column">
          <div class="sudoku-board-stack">
            <div class="sudoku-grid-frame">
              <div class="sudoku-grid" id="sudoku-grid" aria-label="Sudoku board"></div>
            </div>
            <div class="sudoku-pause-overlay" id="sudoku-pause-overlay" aria-hidden="true">
              <button class="sudoku-play-button sudoku-resume-button" id="sudoku-resume" type="button" aria-label="Resume Sudoku">
                <span class="sudoku-play-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </div>
        <div class="sudoku-control-panel" aria-label="Sudoku controls">
          <div class="sudoku-control-section">
            <span class="sudoku-panel-label">Numbers</span>
            <div class="sudoku-number-grid" role="group" aria-label="Number picker">
              ${numberButtonsMarkup()}
              <button type="button" data-sudoku-number="clear">Erase</button>
              <button class="sudoku-note-toggle" id="sudoku-note-toggle" type="button" aria-pressed="false" aria-keyshortcuts="N" aria-describedby="sudoku-note-tooltip">Notes</button>
            </div>
          </div>
          <div class="sudoku-control-section">
            <span class="sudoku-panel-label">Difficulty</span>
            <div class="sudoku-difficulty-grid" role="group" aria-label="Sudoku difficulty">
              ${difficultyButtonsMarkup()}
            </div>
          </div>
          <div class="sudoku-control-section">
            <span class="sudoku-panel-label">Hints</span>
            <div class="sudoku-hint-options" role="group" aria-label="Sudoku hints">
              <button class="is-selected" type="button" data-sudoku-hint="off" aria-pressed="true">Off</button>
              <button type="button" data-sudoku-hint="conflicts" aria-pressed="false">Conflicts</button>
              <button type="button" data-sudoku-hint="errors" aria-pressed="false">Errors</button>
            </div>
          </div>
          <div class="sudoku-actions">
            <button type="button" id="sudoku-new">New Game</button>
            <button type="button" id="sudoku-pause" aria-pressed="false">Pause</button>
            <button type="button" id="sudoku-redo" disabled>Redo</button>
            <button type="button" id="sudoku-undo" disabled>Undo</button>
            <button type="button" id="sudoku-check">Check</button>
          </div>
        </div>
      </div>
    </div>
    <div class="sudoku-statusbar">
      <span id="sudoku-status" aria-live="polite" aria-atomic="true">Ready</span>
      <span id="sudoku-mistakes">Mistakes: 0</span>
      <span id="sudoku-time">Time: 00:00</span>
      <span id="sudoku-best" aria-live="polite" aria-atomic="true">Best (Easy, no hints): —</span>
    </div>
    <dialog
      class="sudoku-errors-prompt"
      id="sudoku-errors-prompt"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sudoku-errors-prompt-title"
      aria-describedby="sudoku-errors-prompt-message"
    >
      <div class="sudoku-solve-dialog">
        <div class="title-bar">
          <div class="title-bar-text" id="sudoku-errors-prompt-title">Sudoku</div>
        </div>
        <div class="sudoku-solve-body">
          <span class="sudoku-solve-ball" aria-hidden="true"></span>
          <p class="sudoku-solve-message" id="sudoku-errors-prompt-message">Reveal errors? A board solved with errors shown does not count towards your best time.</p>
          <div class="sudoku-solve-actions sudoku-errors-prompt-actions">
            <button type="button" id="sudoku-errors-cancel" autofocus>Cancel</button>
            <button type="button" id="sudoku-errors-confirm">Reveal errors</button>
          </div>
        </div>
      </div>
    </dialog>
    <div class="sudoku-solve-popup" id="sudoku-solve-popup" aria-hidden="true">
      <div class="sudoku-solve-dialog" role="dialog" aria-modal="false" aria-labelledby="sudoku-solve-title">
        <div class="title-bar">
          <div class="title-bar-text" id="sudoku-solve-title">Sudoku</div>
        </div>
        <div class="sudoku-solve-body">
          <span class="sudoku-solve-ball" aria-hidden="true"></span>
          <p class="sudoku-solve-message" id="sudoku-solve-message">Good job!</p>
          <div class="sudoku-solve-actions">
            <button type="button" id="sudoku-solve-ok">OK</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

// ---------------------------------------------------------------------------
// Puzzle supply: the worker carves puzzles; one spare per difficulty in play
// is kept warm, and a browser that cannot run the worker gets the static
// puzzle for that difficulty in the same tick.

const staticPuzzle = (difficulty) => ({ clues: 0, ...STATIC_PUZZLES[difficulty] });

let generatorWorker = null;
let generatorUnavailable = false;
let generatorNextRequestId = 0;
/** requestId -> { difficulty, resolve }. */
const generatorRequests = new Map();
/** difficulty -> generated puzzles waiting to be adopted. */
const puzzlePool = new Map();
/** difficulty -> resolvers waiting for the next puzzle of that difficulty. */
const puzzleWaiters = new Map();

const abandonGenerator = () => {
  generatorUnavailable = true;
  generatorWorker = null;
  const pending = [...generatorRequests.values()];
  generatorRequests.clear();
  pending.forEach(({ difficulty, resolve }) => resolve(staticPuzzle(difficulty)));
  const waiting = [...puzzleWaiters.entries()];
  puzzleWaiters.clear();
  waiting.forEach(([difficulty, resolvers]) => {
    resolvers.forEach((resolve) => resolve(staticPuzzle(difficulty)));
  });
};

const handleGeneratorMessage = (event) => {
  const { requestId, difficulty, puzzle, solution, clues, error } = event.data || {};
  const request = generatorRequests.get(requestId);
  if (!request) return;
  generatorRequests.delete(requestId);
  request.resolve(error || !puzzle || !solution ? staticPuzzle(request.difficulty) : { clues, puzzle, solution });
  if (difficulty) topUpPuzzlePool(difficulty);
};

const getGeneratorWorker = () => {
  if (generatorWorker || generatorUnavailable) return generatorWorker;
  if (typeof Worker !== "function") {
    abandonGenerator();
    return null;
  }
  try {
    generatorWorker = new Worker(new URL("./sudoku-generator.worker.js", import.meta.url), { type: "module" });
  } catch {
    abandonGenerator();
    return null;
  }
  generatorWorker.addEventListener("message", handleGeneratorMessage);
  generatorWorker.addEventListener("error", abandonGenerator);
  return generatorWorker;
};

const generatePuzzle = (difficulty, resolve) => {
  const worker = getGeneratorWorker();
  if (!worker) {
    resolve(staticPuzzle(difficulty));
    return;
  }
  const requestId = (generatorNextRequestId += 1);
  generatorRequests.set(requestId, { difficulty, resolve });
  worker.postMessage({
    requestId,
    difficulty,
    targetClues: GENERATOR_CLUES[difficulty] || GENERATOR_CLUES.easy,
    maxAttempts: GENERATOR_MAX_ATTEMPTS,
  });
};

const puzzlesInFlightFor = (difficulty) =>
  [...generatorRequests.values()].filter((request) => request.difficulty === difficulty).length;

/** Keeps at most POOL_TARGET spares per difficulty; extras are dropped. */
const returnPuzzleToPool = (difficulty, generated) => {
  const pool = puzzlePool.get(difficulty) || [];
  if (pool.length >= POOL_TARGET) return;
  pool.push(generated);
  puzzlePool.set(difficulty, pool);
};

const cancelPuzzleWaiter = (difficulty, adopt) => {
  const waiters = puzzleWaiters.get(difficulty);
  const index = waiters ? waiters.indexOf(adopt) : -1;
  if (index < 0) return;
  waiters.splice(index, 1);
  if (!waiters.length) puzzleWaiters.delete(difficulty);
};

/** Keeps one spare warm for a difficulty in play; others are never pre-generated. */
const topUpPuzzlePool = (difficulty) => {
  if (generatorUnavailable) return;
  const pooled = puzzlePool.get(difficulty)?.length || 0;
  const waiting = puzzleWaiters.get(difficulty)?.length || 0;
  const wanted = POOL_TARGET + waiting - pooled - puzzlesInFlightFor(difficulty);
  for (let request = 0; request < wanted; request += 1) {
    if (generatorUnavailable) return;
    generatePuzzle(difficulty, (generated) => {
      const resolvers = puzzleWaiters.get(difficulty);
      const resolve = resolvers?.shift();
      if (!resolvers?.length) puzzleWaiters.delete(difficulty);
      if (resolve) resolve(generated);
      else returnPuzzleToPool(difficulty, generated);
    });
  }
};

/** Calls back synchronously when a puzzle is warm, otherwise when the worker delivers. */
const withPuzzle = (difficulty, adopt) => {
  const pool = puzzlePool.get(difficulty);
  const pooled = pool?.shift();
  if (pool && !pool.length) puzzlePool.delete(difficulty);
  if (pooled) {
    topUpPuzzlePool(difficulty);
    adopt(pooled);
    return;
  }
  if (generatorUnavailable) {
    adopt(staticPuzzle(difficulty));
    return;
  }
  const waiters = puzzleWaiters.get(difficulty) || [];
  waiters.push(adopt);
  puzzleWaiters.set(difficulty, waiters);
  topUpPuzzlePool(difficulty);
};

// ---------------------------------------------------------------------------
// Helpers shared by the controller.

const createEmptyCells = () => Array.from({ length: CELL_COUNT }, () => "");

const normalizeDigit = (value) => Array.from(String(value || "")).find((char) => DIGITS.includes(char)) || "";

/** One digit, or "" meaning clear; anything else is null and refused. */
const digitInput = (value) => {
  if (value === "") return "";
  if (typeof value !== "string" || value.length !== 1) return null;
  return DIGITS.includes(value) ? value : null;
};

const normalizeDifficulty = (difficulty) => (STATIC_PUZZLES[difficulty] ? difficulty : "easy");

const normalizeHintMode = (mode) => (HINT_MODES.includes(mode) ? mode : "off");

const isGivenAt = (puzzle, index) => DIGITS.includes(String(puzzle || "")[index] || "");

const normalizeGrid = (grid) => {
  const raw = String(grid || "");
  return Array.from({ length: CELL_COUNT }, (unused, index) => (DIGITS.includes(raw[index]) ? raw[index] : BLANK)).join("");
};

const normalizeValues = (values, puzzle) => {
  const raw = Array.isArray(values) ? values : String(values || "");
  const safePuzzle = normalizeGrid(puzzle);
  return Array.from({ length: CELL_COUNT }, (unused, index) =>
    isGivenAt(safePuzzle, index) ? safePuzzle[index] : normalizeDigit(raw[index])
  );
};

const normalizeNotesList = (notes, puzzle) => {
  const safePuzzle = normalizeGrid(puzzle);
  const rawNotes = Array.isArray(notes) ? notes : [];
  return Array.from({ length: CELL_COUNT }, (unused, index) =>
    isGivenAt(safePuzzle, index) ? "" : rules.normalizeNotes(rawNotes[index])
  );
};

const normalizeSelectedIndex = (index) => {
  const selectedIndex = Number(index);
  return Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < CELL_COUNT ? selectedIndex : -1;
};

const createPuzzleId = (difficulty) =>
  `generated-${difficulty}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const randomBetween = (min, max) => min + Math.random() * (max - min);
const randomInt = (min, max) => Math.floor(randomBetween(min, max + 1));
const pick = (items) => items[Math.floor(Math.random() * items.length)];

const readBestTimes = () => {
  const raw = storage.readJson(BEST_TIMES_KEY, {});
  const best = {};
  for (const difficulty of rules.DIFFICULTIES) {
    const seconds = Number(raw?.[difficulty]);
    if (Number.isSafeInteger(seconds) && seconds >= 0) best[difficulty] = seconds;
  }
  return best;
};

/** Records `seconds` for `difficulty` when it beats the saved best; returns whether it did. */
const recordBestTime = (difficulty, seconds) => {
  const best = readBestTimes();
  if (best[difficulty] !== undefined && best[difficulty] <= seconds) return false;
  best[difficulty] = seconds;
  storage.writeJson(BEST_TIMES_KEY, best);
  return true;
};

// Both highlight refreshes run on every keystroke. Each keeps the state it
// last wrote so an unchanged cell or button is skipped outright. Nothing else
// writes these classes, and renderGrid drops the caches with the cells it
// replaces.
const STATE_EXHAUSTED = 1;
const STATE_SELECTED = 2;
const STATE_AXIS = 4;
const STATE_SAME_VALUE = 8;
const STATE_CONFLICT = 16;
const STATE_REMAINING_SHIFT = 5;
const STATE_UNWRITTEN = -1;

const resolveStateCache = (cache, elements) =>
  cache.elements === elements ? cache : { elements, states: new Array(elements.length).fill(STATE_UNWRITTEN) };

// ---------------------------------------------------------------------------
// The controller: everything that touches the mounted window.

const createController = (win) => {
  const one = (selector) => win.querySelector(selector);
  const all = (selector) => Array.from(win.querySelectorAll(selector));

  const app = one(".sudoku-app");
  const aeroPanel = one(".sudoku-aero-panel");
  const loadingScreen = one("#sudoku-loading-screen");
  const aquariumLayer = one("#sudoku-aquarium-layer");
  const loadingMeter = one("#sudoku-loading-meter");
  const loadingFill = one("#sudoku-loading-fill");
  const playButton = one("#sudoku-play");
  const grid = one("#sudoku-grid");
  const gridFrame = one(".sudoku-grid-frame");
  const controlPanel = one(".sudoku-control-panel");
  const pauseOverlay = one("#sudoku-pause-overlay");
  const resumeButton = one("#sudoku-resume");
  const difficultyButtons = all("[data-sudoku-difficulty]");
  const numberButtons = all("[data-sudoku-number]");
  const hintButtons = all("[data-sudoku-hint]");
  const noteToggle = one("#sudoku-note-toggle");
  const newButton = one("#sudoku-new");
  const undoButton = one("#sudoku-undo");
  const redoButton = one("#sudoku-redo");
  const checkButton = one("#sudoku-check");
  const pauseButton = one("#sudoku-pause");
  const statusEl = one("#sudoku-status");
  const mistakesEl = one("#sudoku-mistakes");
  const timeEl = one("#sudoku-time");
  const bestEl = one("#sudoku-best");
  const errorsHint = one('[data-sudoku-hint="errors"]');
  const errorsPrompt = one("#sudoku-errors-prompt");
  const errorsCancel = one("#sudoku-errors-cancel");
  const errorsConfirm = one("#sudoku-errors-confirm");
  const solvePopup = one("#sudoku-solve-popup");
  const solveMessage = one("#sudoku-solve-message");
  const solveOk = one("#sudoku-solve-ok");

  let state = {
    difficulty: "easy",
    // Blank scaffolding: the first puzzle is carved off-thread when Sudoku is
    // opened, so a page that never opens it never adopts one.
    puzzleId: "",
    puzzle: BLANK.repeat(CELL_COUNT),
    solution: BLANK.repeat(CELL_COUNT),
    mistakes: 0,
    elapsedSeconds: 0,
    timerId: null,
    timerStartedAt: 0,
    loadingTimerId: null,
    transitionTimerId: null,
    loadingStartedAt: 0,
    loadingDuration: 0,
    loadingProgress: 0,
    playing: false,
    solved: false,
    completionRecorded: false,
    usedHint: false,
    errorsConfirmed: false,
    hintMode: "off",
    noteMode: false,
    values: createEmptyCells(),
    notes: createEmptyCells(),
    selectedIndex: -1,
  };

  /** The engine's view of the puzzle on screen; it also owns undo and redo. */
  let game = null;
  let cellElements = [];
  let puzzleReady = false;
  let puzzleRequestToken = 0;
  // Pause is not part of `state`: a new puzzle replaces that object wholesale,
  // and the save carries no paused flag, because a reload comes back through
  // the boot loader and its Play button.
  let paused = false;
  let statusBeforePause = "";
  let saveTimerId = null;
  let fishTimerId = null;
  let bubbleTimerId = null;
  let noteTooltip = null;
  let pendingAdoption = null;
  let fullBoardPromptActive = false;
  let highlightCache = { elements: null, states: [] };
  let keypadCache = { elements: null, states: [] };
  let conflictCache = { elements: null, states: [] };

  const cells = () => (cellElements.length ? cellElements : Array.from(grid.querySelectorAll(".sudoku-cell")));

  const isVisible = () => isWindowOpen(APP_ID);

  const isReducedMotion = () => Boolean(reducedMotionQuery?.matches);

  // --- engine projection ---------------------------------------------------

  const projectGame = () => {
    state.difficulty = game.difficulty;
    state.puzzle = game.puzzle;
    state.solution = game.solution;
    state.values = Array.from(game.values, (digit) => (digit === BLANK ? "" : digit));
    state.notes = game.notes.slice();
    state.selectedIndex = game.selectedIndex;
    state.hintMode = game.hintMode;
    state.noteMode = game.noteMode;
    state.mistakes = game.mistakes;
    state.usedHint = game.usedHint;
    state.errorsConfirmed = game.errorsConfirmed;
    state.solved = game.solved;
  };

  const refreshChangedCells = (before) => {
    const list = cells();
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (before.values[index] === game.values[index] && before.notes[index] === game.notes[index]) continue;
      const cell = list[index];
      if (!cell) continue;
      refreshCellDisplay(cell, index);
      cell.classList.remove("is-invalid");
    }
  };

  const updateHistoryButtons = () => {
    undoButton.disabled = !game?.undo.length;
    redoButton.disabled = !game?.redo.length;
  };

  /** Plays one move through the engine; false when it was not available. */
  const applyMove = (action) => {
    if (!game || !rules.canApply(game, action)) return false;
    const before = { values: game.values, notes: game.notes.slice() };
    rules.transition(game, action);
    projectGame();
    refreshChangedCells(before);
    return true;
  };

  /** Selecting is not a move, but an undo restores the cell the edit was made in. */
  const syncSelection = () => {
    if (!game || game.selectedIndex === state.selectedIndex) return;
    applyMove({ op: "select", index: normalizeSelectedIndex(state.selectedIndex) });
  };

  // --- clock, status and save ----------------------------------------------

  const currentElapsedSeconds = () => {
    if (!state.timerStartedAt) return state.elapsedSeconds;
    return state.elapsedSeconds + Math.floor((Date.now() - state.timerStartedAt) / 1000);
  };

  const createSavePayload = () => ({
    version: 1,
    difficulty: state.difficulty,
    puzzleId: state.puzzleId,
    puzzle: state.puzzle,
    solution: state.solution,
    values: normalizeValues(state.values, state.puzzle)
      .map((value) => value || BLANK)
      .join(""),
    notes: normalizeNotesList(state.notes, state.puzzle),
    elapsedSeconds: currentElapsedSeconds(),
    hintMode: state.hintMode,
    noteMode: state.noteMode,
    selectedIndex: normalizeSelectedIndex(state.selectedIndex),
    usedHint: state.usedHint,
    errorsConfirmed: state.errorsConfirmed,
    solved: state.solved,
    completionRecorded: state.completionRecorded,
  });

  const flushSave = () => {
    // Before the first puzzle is adopted the board is blank scaffolding.
    if (!puzzleReady) return;
    if (saveTimerId) {
      clearTimeout(saveTimerId);
      saveTimerId = null;
    }
    storage.writeJson(STORAGE_KEY, createSavePayload());
  };

  const scheduleSave = () => {
    saveTimerId = debounceTimer(saveTimerId, flushSave, SAVE_DEBOUNCE_MS);
  };

  const restoreSavedState = () => {
    const saved = storage.readJson(STORAGE_KEY, null);
    if (!saved || saved.version !== 1) return false;
    const difficulty = normalizeDifficulty(saved.difficulty);
    const puzzle = normalizeGrid(saved.puzzle);
    const solution = normalizeGrid(saved.solution);
    if (!rules.solutionMatchesPuzzle(puzzle, solution) || puzzle === solution) return false;

    state.difficulty = difficulty;
    state.puzzleId = String(saved.puzzleId || "") || createPuzzleId(difficulty);
    state.puzzle = puzzle;
    state.solution = solution;
    state.mistakes = 0;
    state.elapsedSeconds = Math.max(0, Math.floor(Number(saved.elapsedSeconds) || 0));
    state.timerId = null;
    state.timerStartedAt = 0;
    state.playing = false;
    state.solved = Boolean(saved.solved);
    state.completionRecorded = Boolean(saved.completionRecorded || saved.solved);
    state.usedHint = Boolean(saved.usedHint);
    state.errorsConfirmed = Boolean(saved.errorsConfirmed || saved.hintMode === "errors" || saved.usedHint);
    state.hintMode = normalizeHintMode(saved.hintMode);
    state.noteMode = Boolean(saved.noteMode);
    state.values = normalizeValues(saved.values, puzzle);
    state.notes = normalizeNotesList(saved.notes, puzzle);
    state.selectedIndex = normalizeSelectedIndex(saved.selectedIndex);

    const board = {
      difficulty,
      puzzle,
      solution,
      values: state.values.map((value) => value || BLANK).join(""),
      notes: state.notes,
      selectedIndex: state.selectedIndex,
      hintMode: state.hintMode,
      noteMode: state.noteMode,
      errorsConfirmed: state.errorsConfirmed,
      usedHint: state.usedHint,
    };
    game = rules.initial(board);
    // A save can claim to be finished; the claim is taken only where the grid
    // supports it, and the completion latch is kept either way.
    const outcome = rules.evaluate(game);
    if (state.solved && outcome.complete && outcome.valid) game = rules.initial({ ...board, solved: true });
    projectGame();
    return true;
  };

  const updateTimeDisplay = () => {
    timeEl.textContent = `Time: ${formatElapsedTime(currentElapsedSeconds())}`;
  };

  const updateMistakesDisplay = () => {
    mistakesEl.textContent = `Mistakes: ${state.mistakes}`;
  };

  const updateBestTimeDisplay = () => {
    const best = readBestTimes()[state.difficulty];
    const message = `Best (${DIFFICULTY_LABELS[state.difficulty]}, no hints): ${formatElapsedTime(best)}`;
    if (bestEl.textContent !== message) bestEl.textContent = message;
  };

  const setStatus = (message) => {
    statusEl.textContent = message;
    updateMistakesDisplay();
    updateTimeDisplay();
    updateBestTimeDisplay();
  };

  const startTimer = () => {
    if (state.solved || state.timerId) return;
    state.timerStartedAt = Date.now();
    state.timerId = window.setInterval(updateTimeDisplay, TIMER_INTERVAL_MS);
    updateTimeDisplay();
  };

  const pauseTimer = () => {
    if (!state.timerId) return;
    state.elapsedSeconds = currentElapsedSeconds();
    clearInterval(state.timerId);
    state.timerId = null;
    state.timerStartedAt = 0;
    updateTimeDisplay();
    scheduleSave();
  };

  const resetTimer = () => {
    if (state.timerId) clearInterval(state.timerId);
    state.elapsedSeconds = 0;
    state.timerId = null;
    state.timerStartedAt = 0;
    updateTimeDisplay();
  };

  // --- loader and boot sequence --------------------------------------------

  const setLoadingProgress = (progress) => {
    state.loadingProgress = clamp(progress, 0, 100);
    const rounded = Math.round(state.loadingProgress);
    loadingFill.style.setProperty("--sudoku-load-progress", `${rounded}%`);
    loadingMeter.setAttribute("aria-valuenow", String(rounded));
  };

  const clearTransitionTimer = () => {
    if (!state.transitionTimerId) return;
    clearTimeout(state.transitionTimerId);
    state.transitionTimerId = null;
  };

  const clearPlayBurst = () => {
    app.classList.remove("is-sudoku-bursting");
    playButton.classList.remove("animate");
    win.querySelectorAll(".sudoku-burst-effect").forEach((element) => element.remove());
  };

  const triggerBubbleBurst = (target, variant) => {
    const className = `sudoku-burst-effect--${variant}`;
    target.querySelectorAll(`.${className}`).forEach((element) => element.remove());
    const effect = document.createElement("span");
    effect.className = `sudoku-burst-effect ${className}`;
    effect.setAttribute("aria-hidden", "true");
    target.append(effect);
    window.setTimeout(() => effect.remove(), PLAY_BURST_MS + 120);
  };

  // --- aquarium --------------------------------------------------------------

  const isAquariumActive = () => Boolean(state.playing && isVisible() && isPageActive(document) && !isReducedMotion());

  const sampleFishDepth = () => {
    const roll = Math.random();
    if (roll < 0.7) return "far";
    if (roll < 0.93) return "mid";
    return "near";
  };

  const clearAquariumTimers = () => {
    if (fishTimerId) {
      clearTimeout(fishTimerId);
      fishTimerId = null;
    }
    if (bubbleTimerId) {
      clearTimeout(bubbleTimerId);
      bubbleTimerId = null;
    }
  };

  const clearAquarium = () => {
    clearAquariumTimers();
    aquariumLayer.querySelectorAll(".sudoku-fish, .sudoku-bubble-cluster").forEach((element) => element.remove());
  };

  const createFishElement = ({ depth, type, top, size, opacity, blur, saturate, duration, delay, direction }) => {
    const fish = document.createElement("span");
    fish.className = `sudoku-fish sudoku-fish--${type} sudoku-fish--${depth}`;
    fish.setAttribute("aria-hidden", "true");
    fish.style.setProperty("--fish-top", `${top.toFixed(1)}%`);
    fish.style.setProperty("--fish-size", `${Math.round(size)}px`);
    fish.style.setProperty("--fish-opacity", opacity.toFixed(2));
    fish.style.setProperty("--fish-blur", `${blur.toFixed(2)}px`);
    fish.style.setProperty("--fish-saturate", saturate.toFixed(2));
    fish.style.setProperty("--fish-duration", `${Math.round(duration)}ms`);
    fish.style.setProperty("--fish-delay", `${Math.round(delay)}ms`);
    fish.style.setProperty("--fish-start-left", direction === 1 ? "-22%" : "122%");
    fish.style.setProperty("--fish-end-left", direction === 1 ? "122%" : "-22%");
    fish.style.setProperty("--fish-dir", String(direction));
    fish.style.setProperty("--fish-bob", `${randomBetween(2, 8).toFixed(1)}px`);
    const body = document.createElement("span");
    body.className = "sudoku-fish-body";
    fish.append(body);
    fish.addEventListener("animationend", () => fish.remove(), { once: true });
    return fish;
  };

  const spawnFishPass = () => {
    if (!isAquariumActive()) return;
    const liveFishCount = aquariumLayer.querySelectorAll(".sudoku-fish").length;
    const availableSlots = MAX_FISH - liveFishCount;
    if (availableSlots <= 0) return;
    const depth = sampleFishDepth();
    const config = FISH_DEPTHS[depth];
    const isSchool = Math.random() < config.schoolChance;
    const count = Math.min(availableSlots, isSchool ? randomInt(config.school[0], config.school[1]) : 1);
    const baseType = pick(FISH_TYPES);
    const baseTop = randomBetween(config.top[0], config.top[1]);
    const baseSize = randomBetween(config.size[0], config.size[1]);
    const direction = Math.random() < 0.5 ? 1 : -1;
    for (let index = 0; index < count; index += 1) {
      const topOffset = count === 1 ? 0 : (index - (count - 1) / 2) * randomBetween(3, 7) + randomBetween(-2, 2);
      aquariumLayer.append(
        createFishElement({
          depth,
          type: Math.random() < 0.75 ? baseType : pick(FISH_TYPES),
          top: clamp(baseTop + topOffset, 8, 90),
          size: baseSize * randomBetween(0.84, 1.26),
          opacity: randomBetween(config.opacity[0], config.opacity[1]),
          blur: randomBetween(config.blur[0], config.blur[1]),
          saturate: randomBetween(config.saturate[0], config.saturate[1]),
          duration: randomBetween(config.duration[0], config.duration[1]),
          delay: index * randomBetween(120, 420),
          direction,
        })
      );
    }
  };

  const spawnBubbleCluster = () => {
    if (!isAquariumActive()) return;
    if (aquariumLayer.querySelectorAll(".sudoku-bubble-cluster").length >= MAX_BUBBLE_CLUSTERS) return;
    const cluster = document.createElement("span");
    const bubbleCount = randomInt(4, 10);
    cluster.className = "sudoku-bubble-cluster";
    cluster.setAttribute("aria-hidden", "true");
    cluster.style.setProperty("--bubble-left", `${randomBetween(12, 88).toFixed(1)}%`);
    cluster.style.setProperty("--bubble-width", `${Math.round(randomBetween(48, 110))}px`);
    cluster.style.setProperty("--bubble-duration", `${Math.round(randomBetween(9000, 14000))}ms`);
    cluster.style.setProperty("--bubble-opacity", randomBetween(0.56, 0.84).toFixed(2));
    cluster.style.setProperty("--bubble-drift", `${randomBetween(-30, 30).toFixed(1)}px`);
    for (let index = 0; index < bubbleCount; index += 1) {
      const bubble = document.createElement("span");
      bubble.className = "sudoku-bubble";
      bubble.style.setProperty("--bubble-size", `${Math.round(randomBetween(7, 22))}px`);
      bubble.style.setProperty("--bubble-offset", `${randomBetween(4, 96).toFixed(1)}%`);
      bubble.style.setProperty("--bubble-bottom", `${Math.round(randomBetween(0, 66))}px`);
      bubble.style.setProperty("--bubble-wobble", `${Math.round(randomBetween(1200, 2600))}ms`);
      cluster.append(bubble);
    }
    cluster.addEventListener("animationend", () => cluster.remove(), { once: true });
    aquariumLayer.append(cluster);
  };

  const scheduleFish = (delay = 0) => {
    if (!isAquariumActive() || fishTimerId) return;
    fishTimerId = window.setTimeout(() => {
      fishTimerId = null;
      if (!isAquariumActive()) return;
      spawnFishPass();
      scheduleFish(randomBetween(1600, 4800));
    }, delay);
  };

  const scheduleBubbles = (delay = 0) => {
    if (!isAquariumActive() || bubbleTimerId) return;
    bubbleTimerId = window.setTimeout(() => {
      bubbleTimerId = null;
      if (!isAquariumActive()) return;
      spawnBubbleCluster();
      scheduleBubbles(randomBetween(2500, 7500));
    }, delay);
  };

  const startAquarium = () => {
    if (!isAquariumActive()) return;
    scheduleFish(randomBetween(300, 1400));
    scheduleBubbles(randomBetween(1400, 3200));
  };

  const syncAquariumActivity = () => {
    if (isAquariumActive()) startAquarium();
    else clearAquarium();
  };

  // --- pause -----------------------------------------------------------------

  /**
   * Pause hides the board rather than covering it: values and notes go
   * invisible and the board and control panel drop to a wash so the aquarium
   * reads through them. Both regions also go `inert`, so a paused board cannot
   * be clicked, tabbed into or typed on; the centred play button is the only
   * way back. The aquarium keeps swimming: pausing stops the clock, not the window.
   */
  const setPaused = (next) => {
    const nextPaused = Boolean(next) && state.playing && !state.solved;
    if (nextPaused === paused) return;
    paused = nextPaused;
    app.classList.toggle("is-sudoku-paused", paused);
    gridFrame.inert = paused;
    controlPanel.inert = paused;
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseOverlay.setAttribute("aria-hidden", String(!paused));
    if (paused) {
      statusBeforePause = statusEl.textContent || "";
      pauseTimer();
      setStatus("Paused");
      if (isVisible()) resumeButton.focus();
      return;
    }
    setStatus(statusBeforePause || (state.solved ? "Solved" : "Ready"));
    statusBeforePause = "";
    if (!isVisible() || !state.playing) return;
    startTimer();
    (selectedCell() || pauseButton).focus();
  };

  // A hidden tab pauses the game as well as the aquarium; coming back does
  // not resume it, so time never runs on a board nobody is looking at.
  const handleVisibilityChange = () => {
    if (document.hidden) setPaused(true);
    syncAquariumActivity();
  };

  const clampWindow = () => {
    if (!isVisible()) return;
    clampIntoViewport(win, { padding: 12 });
  };

  const scheduleWindowClamp = () => {
    afterFrames(1, () => {
      clampWindow();
      afterFrames(1, clampWindow);
    });
  };

  const setBootState = (bootState) => {
    app.classList.toggle("is-sudoku-loading", bootState === "loading");
    app.classList.toggle("is-sudoku-ready", bootState === "ready");
    app.classList.toggle("is-sudoku-bursting", bootState === "bursting");
    app.classList.toggle("is-sudoku-playing", bootState === "playing");
    win.classList.toggle("is-sudoku-playing", bootState === "playing");
    playButton.disabled = bootState !== "ready";
    loadingScreen.setAttribute("aria-hidden", String(bootState === "playing"));
    if (bootState === "playing") {
      scheduleWindowClamp();
      startAquarium();
    } else {
      clearAquarium();
    }
  };

  const finishLoadingSequence = () => {
    state.loadingStartedAt = 0;
    setBootState("ready");
    requestAnimationFrame(() => {
      if (isVisible()) playButton.focus();
    });
  };

  // The meter runs for at least its floor, then holds at 98 until a real
  // puzzle exists. Play is offered on readiness, never on a timer alone.
  const progressLoader = createProgressLoader({
    progressCap: 98,
    isReady: () => puzzleReady,
    shouldContinue: () => isVisible() && !state.playing,
    nextProgress: ({ elapsedMs, durationMs, progress }) => {
      const targetProgress = (elapsedMs / durationMs) * 100;
      const jump = 3 + Math.random() * 14;
      const catchup = Math.max(0, targetProgress - progress) * 0.58;
      return Math.max(progress + 1, progress + jump + catchup);
    },
    nextDelay: ({ elapsedMs, durationMs, waitingForReady }) =>
      waitingForReady ? LOAD_READY_POLL_MS : Math.min(90 + Math.random() * 210, Math.max(0, durationMs - elapsedMs)),
    onProgress: setLoadingProgress,
    onReady: finishLoadingSequence,
    onTimerChange: (timerId) => {
      state.loadingTimerId = timerId;
    },
  });

  const startBootSequence = () => {
    pauseTimer();
    hideErrorsPrompt({ restoreFocus: false });
    hideSolvePopup();
    clearTransitionTimer();
    clearPlayBurst();
    state.playing = false;
    setPaused(false);
    state.loadingDuration = LOAD_MIN_MS;
    // Opening Sudoku is what starts the generator: the first puzzle if there
    // is none, and otherwise a spare so the next New Game is instant.
    if (puzzleReady) topUpPuzzlePool(state.difficulty);
    else loadDifficulty(state.difficulty);
    setBootState("loading");
    const loading = progressLoader.start({
      duration: state.loadingDuration,
      initialDelay: 120 + Math.random() * 180,
    });
    state.loadingStartedAt = loading.startedAt;
  };

  const clearBootSequence = () => {
    progressLoader.cancel();
    clearTransitionTimer();
    clearPlayBurst();
    clearAquarium();
    hideErrorsPrompt({ restoreFocus: false });
    hideSolvePopup();
    hideNoteTooltip();
    state.playing = false;
    setPaused(false);
    state.loadingStartedAt = 0;
    state.loadingDuration = 0;
    setLoadingProgress(0);
    scheduleSave();
  };

  const selectedCell = () => {
    const index = normalizeSelectedIndex(state.selectedIndex);
    return index >= 0 ? cells()[index] || null : null;
  };

  const focusCell = (index) => {
    const selectedIndex = normalizeSelectedIndex(index);
    const cell = selectedIndex >= 0 ? cells()[selectedIndex] : null;
    if (!cell) return;
    selectCell(cell);
    cell.focus();
  };

  const focusNextEditableCell = (index) => {
    const list = cells();
    if (!list.length) return;
    for (let offset = 1; offset <= CELL_COUNT; offset += 1) {
      const nextIndex = (index + offset) % CELL_COUNT;
      if (list[nextIndex] && !list[nextIndex].readOnly) {
        focusCell(nextIndex);
        return;
      }
    }
  };

  const revealGameFromBoot = () => {
    clearTransitionTimer();
    clearPlayBurst();
    progressLoader.cancel();
    if (!isVisible()) return;
    state.playing = true;
    setLoadingProgress(100);
    setBootState("playing");
    setStatus(state.solved ? "Solved" : "Ready");
    startTimer();
    const firstOpenCell = selectedCell() || cells().find((cell) => !cell.readOnly);
    requestAnimationFrame(() => {
      if (firstOpenCell) firstOpenCell.focus();
    });
    scheduleSave();
  };

  const startGameFromBoot = () => {
    if (state.transitionTimerId) return;
    clearTransitionTimer();
    setBootState("bursting");
    playButton.classList.remove("animate");
    void playButton.offsetWidth;
    playButton.classList.add("animate");
    state.transitionTimerId = window.setTimeout(revealGameFromBoot, PLAY_BURST_MS);
  };

  // --- cells and keypad ------------------------------------------------------

  const updateDifficultyButtons = () => {
    app.dataset.sudokuDifficulty = state.difficulty;
    for (const button of difficultyButtons) {
      const isSelected = button.dataset.sudokuDifficulty === state.difficulty;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    }
  };

  const cellValue = (index) => state.values[index] || "";

  const cellNotes = (index) => state.notes[index] || "";

  const updateCellAriaLabel = (cell, index) => {
    const row = Math.floor(index / 9) + 1;
    const column = (index % 9) + 1;
    const value = cellValue(index);
    const notes = cellNotes(index);
    const valueText = value ? `Value ${value}` : "Empty";
    const noteText = !value && notes ? `Notes ${notes.split("").join(", ")}` : "No notes";
    const conflictText = cell.classList.contains("is-conflict") ? " Conflict." : "";
    cell.setAttribute("aria-label", `Row ${row}, column ${column}. ${valueText}. ${noteText}.${conflictText}`);
  };

  const refreshCellDisplay = (cell, index) => {
    const value = cellValue(index);
    const notes = cellNotes(index);
    cell.valueEl.textContent = value;
    cell.noteDigits.forEach((note, digitIndex) => {
      const digit = String(digitIndex + 1);
      note.textContent = notes.includes(digit) ? digit : "";
    });
    cell.dataset.sudokuValue = value;
    cell.classList.toggle("has-value", Boolean(value));
    cell.classList.toggle("has-notes", !value && Boolean(notes));
    updateCellAriaLabel(cell, index);
  };

  const updateNoteToggle = () => {
    noteToggle.classList.toggle("is-selected", state.noteMode);
    noteToggle.setAttribute("aria-pressed", String(state.noteMode));
  };

  // Counts in place: this runs on every keystroke.
  const countDigitPlacements = () => {
    const counts = Object.fromEntries(DIGITS.split("").map((digit) => [digit, 0]));
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const value = isGivenAt(state.puzzle, index) ? state.puzzle[index] : normalizeDigit(state.values[index]);
      if (value) counts[value] += 1;
    }
    return counts;
  };

  const updateRemainingBadge = (button, digit, remaining) => {
    const badge = button.querySelector(".sudoku-number-remaining");
    badge.textContent = remaining > 0 ? String(remaining) : "";
    button.setAttribute("aria-label", remaining > 0 ? `${digit}, ${remaining} left` : `${digit}, none left`);
  };

  // A digit placed nine times has no legal cell left, so its keypad button
  // greys out. Keyboard entry stays open so a wrong ninth placement can still
  // be overwritten.
  const updateNumberButtons = () => {
    const cell = selectedCell();
    const editable = cell && !cell.readOnly;
    const selectedIndex = editable ? Number(cell.dataset.sudokuIndex) : -1;
    const selectedValue = editable ? cellValue(selectedIndex) : "";
    const selectedNotes = editable ? cellNotes(selectedIndex) : "";
    const digitCounts = countDigitPlacements();
    keypadCache = resolveStateCache(keypadCache, numberButtons);
    numberButtons.forEach((button, buttonIndex) => {
      const value = button.dataset.sudokuNumber;
      const isDigit = DIGITS.includes(value);
      const remaining = isDigit ? ROW_COUNT - digitCounts[value] : 0;
      const isExhausted = isDigit && digitCounts[value] >= ROW_COUNT;
      const isSelected = Boolean(
        (state.noteMode && !selectedValue && isDigit && selectedNotes.includes(value)) ||
          (!state.noteMode && value === selectedValue) ||
          (value === "clear" && editable && !selectedValue && !selectedNotes)
      );
      const flags = (isExhausted ? STATE_EXHAUSTED : 0) | (isSelected ? STATE_SELECTED : 0) | (remaining << STATE_REMAINING_SHIFT);
      if (flags === keypadCache.states[buttonIndex]) return;
      keypadCache.states[buttonIndex] = flags;
      button.classList.toggle("is-exhausted", isExhausted);
      button.disabled = isExhausted;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
      if (isDigit) updateRemainingBadge(button, value, remaining);
    });
    updateNoteToggle();
  };

  const updateHintButtons = () => {
    for (const button of hintButtons) {
      const isSelected = button.dataset.sudokuHint === state.hintMode;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    }
  };

  const clearInvalidMarks = () => {
    cells().forEach((cell) => cell.classList.remove("is-invalid"));
  };

  const clearSolvedWave = () => {
    cells().forEach((cell) => {
      cell.classList.remove("is-solved-wave");
      cell.style.removeProperty("--sudoku-solve-delay");
    });
  };

  // --- prompts ---------------------------------------------------------------

  const hideErrorsPrompt = ({ restoreFocus = true } = {}) => {
    if (!errorsPrompt.open) return;
    errorsPrompt.close();
    if (restoreFocus) requestAnimationFrame(() => errorsHint.focus());
  };

  const showErrorsPrompt = () => {
    if (errorsPrompt.open) return;
    errorsPrompt.showModal();
    requestAnimationFrame(() => errorsCancel.focus());
  };

  const trapErrorsPromptFocus = (event) => {
    if (event.key !== "Tab" || !errorsPrompt.open) return;
    if (event.shiftKey && document.activeElement === errorsCancel) {
      event.preventDefault();
      errorsConfirm.focus();
    } else if (!event.shiftKey && document.activeElement === errorsConfirm) {
      event.preventDefault();
      errorsCancel.focus();
    }
  };

  const isSolvePopupVisible = () =>
    solvePopup.classList.contains("is-visible") && solvePopup.getAttribute("aria-hidden") === "false";

  // The solved dialog and the Errors prompt own the keyboard while open, and
  // a paused board hides its values, so every key path consults this.
  const isModalOpen = () => errorsPrompt.open || isSolvePopupVisible();

  const isBoardLocked = () => isModalOpen() || paused;

  const hideSolvePopup = () => {
    solvePopup.classList.remove("is-visible");
    solvePopup.setAttribute("aria-hidden", "true");
  };

  const showSolvePopup = ({ newBest = false } = {}) => {
    const praise = state.usedHint ? "Good job! Try not to use hints next time." : "Good job!";
    solveMessage.textContent = newBest ? `${praise} New best time for ${DIFFICULTY_LABELS[state.difficulty]}.` : praise;
    solvePopup.classList.add("is-visible");
    solvePopup.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => solveOk.focus());
  };

  // A full but unsolved board can only be resolved by Check, so the button
  // glows gold and replays the sunken-then-raised press. The flag holds the
  // current state so a later board update cannot restart the press mid-glow.
  const refreshFullBoardPrompt = () => {
    const isBoardFull = !state.solved && state.values.length === CELL_COUNT && state.values.every(Boolean);
    if (isBoardFull === fullBoardPromptActive) return;
    fullBoardPromptActive = isBoardFull;
    checkButton.classList.toggle("is-board-full", isBoardFull);
  };

  // Marks the selected cell, its row and column, and every other cell holding
  // the selected value. Runs on selection changes and after any value change.
  const updateBoardHighlights = () => {
    const list = cells();
    const selectedIndex = normalizeSelectedIndex(state.selectedIndex);
    const hasSelection = selectedIndex >= 0 && selectedIndex < list.length;
    const selectedRow = hasSelection ? Math.floor(selectedIndex / 9) : -1;
    const selectedColumn = hasSelection ? selectedIndex % 9 : -1;
    const selectedValue = hasSelection ? cellValue(selectedIndex) : "";
    // Notes matching the selected value light up through one grid attribute.
    if (selectedValue) grid.dataset.sudokuNoteHighlight = selectedValue;
    else delete grid.dataset.sudokuNoteHighlight;
    highlightCache = resolveStateCache(highlightCache, list);
    for (let index = 0; index < list.length; index += 1) {
      const isSelected = index === selectedIndex;
      const isAxis = hasSelection && (Math.floor(index / 9) === selectedRow || index % 9 === selectedColumn);
      const isSameValue = Boolean(selectedValue) && !isSelected && cellValue(index) === selectedValue;
      const flags = (isSelected ? STATE_SELECTED : 0) | (isAxis ? STATE_AXIS : 0) | (isSameValue ? STATE_SAME_VALUE : 0);
      if (flags === highlightCache.states[index]) continue;
      highlightCache.states[index] = flags;
      const { classList } = list[index];
      classList.toggle("is-selected", isSelected);
      classList.toggle("is-axis-highlight", isAxis);
      classList.toggle("is-same-value", isSameValue);
    }
    refreshFullBoardPrompt();
  };

  const selectCell = (cell) => {
    const selectedIndex = normalizeSelectedIndex(cell?.dataset.sudokuIndex);
    state.selectedIndex = selectedIndex < cells().length ? selectedIndex : -1;
    updateBoardHighlights();
    updateNumberButtons();
    scheduleSave();
  };

  const refreshAllCells = () => {
    cells().forEach((cell, index) => {
      refreshCellDisplay(cell, index);
      cell.classList.remove("is-invalid");
    });
  };

  const validateBoard = ({ mark = false } = {}) => {
    const outcome = game ? rules.evaluate(game) : { complete: false, mistakes: 0, valid: true, wrong: [] };
    if (mark) {
      const wrong = new Set(outcome.wrong);
      cells().forEach((cell, index) => {
        cell.classList.remove("is-invalid");
        if (wrong.has(index)) {
          void cell.offsetWidth;
          cell.classList.add("is-invalid");
        }
      });
    }
    return outcome;
  };

  // Diffed like the highlight pass: this runs on every keystroke too.
  const refreshConflictMarks = () => {
    const list = cells();
    conflictCache = resolveStateCache(conflictCache, list);
    const conflicts = state.hintMode === "conflicts" && game ? new Set(rules.conflictIndexes(game)) : null;
    for (let index = 0; index < list.length; index += 1) {
      const flags = conflicts?.has(index) ? STATE_CONFLICT : 0;
      if (flags === conflictCache.states[index]) continue;
      conflictCache.states[index] = flags;
      list[index].classList.toggle("is-conflict", flags === STATE_CONFLICT);
      updateCellAriaLabel(list[index], index);
    }
  };

  /** Paints the current hint mode; the engine already decided what it means. */
  const refreshHintFeedback = () => {
    refreshConflictMarks();
    if (state.hintMode !== "errors") {
      clearInvalidMarks();
      updateMistakesDisplay();
      return validateBoard();
    }
    const outcome = validateBoard({ mark: true });
    updateMistakesDisplay();
    return outcome;
  };

  const showRestoredBoard = () => {
    hideSolvePopup();
    clearSolvedWave();
    refreshAllCells();
    refreshHintFeedback();
    updateBoardHighlights();
    updateNumberButtons();
    updateHistoryButtons();
    setStatus("Ready");
    scheduleSave();
    const cell = selectedCell();
    if (cell && state.playing) cell.focus();
  };

  const undoMove = () => {
    if (applyMove({ op: "undo" })) showRestoredBoard();
  };

  const redoMove = () => {
    if (applyMove({ op: "redo" })) showRestoredBoard();
  };

  /** The shared tail of every edit. */
  const afterEdit = () => {
    hideSolvePopup();
    clearSolvedWave();
    if (state.playing) startTimer();
    refreshHintFeedback();
    updateBoardHighlights();
    updateNumberButtons();
    updateHistoryButtons();
    setStatus("Ready");
    scheduleSave();
  };

  const updateCellValue = (cell, index, value, { clearEmptyNotes = false, autoAdvance = false } = {}) => {
    if (!cell || cell.readOnly) return;
    const digit = digitInput(value);
    if (digit === null) return;
    // Clearing is its own move: on an empty cell the keypad wipes its pencil
    // marks instead, which is why only that path asks for it.
    if (!digit && !clearEmptyNotes && !cellValue(index)) return;
    syncSelection();
    const applied = digit ? applyMove({ op: "setValue", index, value: digit }) : applyMove({ op: "clear", index });
    if (!applied) return;
    afterEdit();
    if (autoAdvance && digit) focusNextEditableCell(index);
  };

  const toggleNote = (cell, index, digit) => {
    if (!cell || cell.readOnly || !digitInput(digit)) return;
    syncSelection();
    if (!applyMove({ op: "toggleNote", index, digit })) return;
    afterEdit();
  };

  const applyDigitToCell = (cell, index, value) => {
    if (state.noteMode) toggleNote(cell, index, value);
    else updateCellValue(cell, index, value, { autoAdvance: true });
  };

  const clearCellValueOrNotes = (cell, index) => {
    updateCellValue(cell, index, "", { clearEmptyNotes: true });
  };

  const applyNumber = (value) => {
    let cell = selectedCell();
    if (!cell || cell.readOnly) cell = cells().find((candidate) => !candidate.readOnly) || null;
    if (!cell || cell.readOnly) return;
    const index = Number(cell.dataset.sudokuIndex);
    if (!Number.isInteger(index)) return;
    state.selectedIndex = index;
    selectCell(cell);
    if (value === "clear") clearCellValueOrNotes(cell, index);
    else applyDigitToCell(cell, index, value);
    (selectedCell() || cell).focus();
  };

  const setHintMode = (mode) => {
    if (mode === "errors" && !state.errorsConfirmed) {
      showErrorsPrompt();
      return;
    }
    if (!applyMove({ op: "setHintMode", mode: normalizeHintMode(mode) })) return;
    updateHintButtons();
    refreshHintFeedback();
    setStatus("Ready");
    scheduleSave();
  };

  const confirmErrors = () => {
    applyMove({ op: "confirmErrors" });
    hideErrorsPrompt();
    setHintMode("errors");
  };

  const setNoteMode = (enabled) => {
    if (!applyMove({ op: "setNoteMode", enabled: Boolean(enabled) })) return;
    updateNoteToggle();
    updateNumberButtons();
    scheduleSave();
  };

  // --- winning ---------------------------------------------------------------

  const triggerVictoryEffects = () => {
    if (isReducedMotion()) return;
    const effects = WIN_EFFECTS[state.difficulty];
    if (!effects) return;
    if (!state.usedHint) showAchievement(ACHIEVEMENT_IMAGE);
    if (effects.fireworks && !state.usedHint) startFireworks();
    if (effects.confetti) startConfetti();
  };

  const triggerSolvedTileWave = () => {
    const list = cells();
    clearSolvedWave();
    void grid.offsetWidth;
    list.forEach((cell, index) => {
      cell.style.setProperty("--sudoku-solve-delay", `${index * 28}ms`);
      cell.classList.add("is-solved-wave");
    });
  };

  /** Records a no-hint solve as a best time; returns whether it set a record. */
  const recordCompletion = () => {
    const newBest = !state.usedHint && recordBestTime(state.difficulty, currentElapsedSeconds());
    updateBestTimeDisplay();
    triggerVictoryEffects();
    return newBest;
  };

  const checkBoard = () => {
    // A finished board is terminal: Check puts the solved dialog back up.
    if (state.solved) {
      showSolvePopup();
      refreshFullBoardPrompt();
      return;
    }
    const outcome = validateBoard();
    if (!applyMove({ op: "check" })) return;
    if (!outcome.complete || !outcome.valid) {
      validateBoard({ mark: true });
      if (outcome.valid) {
        triggerBubbleBurst(checkButton, "button");
        setStatus("Ready");
      } else {
        setStatus("System alert");
      }
      scheduleSave();
      return;
    }
    setStatus("Solved");
    triggerBubbleBurst(aeroPanel, "full");
    triggerSolvedTileWave();
    pauseTimer();
    let newBest = false;
    if (!state.completionRecorded) {
      state.completionRecorded = true;
      newBest = recordCompletion();
    }
    showSolvePopup({ newBest });
    flushSave();
    refreshFullBoardPrompt();
  };

  // --- grid ------------------------------------------------------------------

  const renderGrid = () => {
    grid.replaceChildren();
    cellElements = [];
    grid.setAttribute("role", "grid");
    // The engine holds the authoritative board, so drawing reads it.
    if (game) projectGame();
    const fragment = document.createDocumentFragment();
    // A grid exposes its cells through rows; `.sudoku-row` is `display:
    // contents` so the board keeps its single 9x9 CSS grid.
    const rowElements = Array.from({ length: ROW_COUNT }, (unused, rowIndex) => {
      const rowElement = document.createElement("div");
      rowElement.className = "sudoku-row";
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", String(rowIndex + 1));
      fragment.append(rowElement);
      return rowElement;
    });
    state.puzzle.split("").forEach((given, index) => {
      const cell = document.createElement("div");
      cell.className = "sudoku-cell";
      cell.tabIndex = 0;
      cell.readOnly = false;
      cell.dataset.sudokuIndex = String(index);
      cell.setAttribute("role", "gridcell");
      const valueEl = document.createElement("span");
      valueEl.className = "sudoku-cell-value";
      const notesEl = document.createElement("span");
      notesEl.className = "sudoku-cell-notes";
      notesEl.setAttribute("aria-hidden", "true");
      cell.valueEl = valueEl;
      cell.noteDigits = DIGITS.split("").map((noteDigit) => {
        const note = document.createElement("span");
        note.className = "sudoku-note-digit";
        // Each slot always stands for the same digit, so the stylesheet can
        // match it against the grid's selected value with no per-key work.
        note.dataset.sudokuNote = noteDigit;
        notesEl.append(note);
        return note;
      });
      cell.append(valueEl, notesEl);
      if (DIGITS.includes(given)) {
        cell.readOnly = true;
        cell.classList.add("is-given");
        state.values[index] = given;
        state.notes[index] = "";
      }
      refreshCellDisplay(cell, index);
      cellElements[index] = cell;
      rowElements[Math.floor(index / ROW_COUNT)].append(cell);
    });
    grid.append(fragment);

    updateDifficultyButtons();
    updateHintButtons();
    refreshHintFeedback();
    selectCell(cellElements[state.selectedIndex] || null);
    updateHistoryButtons();
    updateTimeDisplay();
    setStatus(state.solved ? "Solved" : "Ready");
  };

  // A warm puzzle is adopted in the same tick, so this state is usually never
  // seen. A cold difficulty leaves the current board up: the grid reports
  // `aria-busy` and the status says so, rather than the window freezing.
  const setGeneratingState = (isGenerating) => {
    grid.setAttribute("aria-busy", String(isGenerating));
    if (isGenerating) setStatus(GENERATING_STATUS);
  };

  /** Replaces the board with a generated puzzle; the id is minted here. */
  const adoptPuzzle = (difficulty, generated) => {
    const wasPlaying = state.playing;
    const previousNoteMode = state.noteMode;
    const { loadingTimerId, transitionTimerId, loadingStartedAt, loadingDuration, loadingProgress } = state;
    hideErrorsPrompt({ restoreFocus: false });
    hideSolvePopup();
    pauseTimer();
    state = {
      difficulty,
      puzzleId: createPuzzleId(difficulty),
      puzzle: generated.puzzle,
      solution: generated.solution,
      mistakes: 0,
      elapsedSeconds: 0,
      timerId: null,
      timerStartedAt: 0,
      loadingTimerId,
      transitionTimerId,
      loadingStartedAt,
      loadingDuration,
      loadingProgress,
      playing: wasPlaying,
      solved: false,
      completionRecorded: false,
      usedHint: false,
      errorsConfirmed: false,
      hintMode: "off",
      noteMode: previousNoteMode,
      values: normalizeValues("", generated.puzzle),
      notes: createEmptyCells(),
      selectedIndex: -1,
    };
    game = rules.initial({
      difficulty,
      puzzle: generated.puzzle,
      solution: generated.solution,
      noteMode: previousNoteMode,
    });
    puzzleReady = true;
    renderGrid();
    setGeneratingState(false);
    resetTimer();
    scheduleSave();
    // A cold difficulty can land while the player is paused, by hand or by a
    // hidden tab. The new board is adopted behind the resume overlay and the
    // clock waits for the play button; resuming then reports Ready.
    if (paused) {
      statusBeforePause = "Ready";
      setStatus("Paused");
      return;
    }
    if (isVisible() && wasPlaying) startTimer();
  };

  /**
   * New Game and the difficulty buttons never block. Only the newest request
   * can reach the board, so an older waiter is withdrawn rather than left to
   * draw a generation nobody will adopt; work already in flight still
   * delivers into the capped pool.
   */
  const loadDifficulty = (difficulty) => {
    const normalized = normalizeDifficulty(difficulty);
    const token = (puzzleRequestToken += 1);
    if (pendingAdoption) {
      cancelPuzzleWaiter(pendingAdoption.difficulty, pendingAdoption.adopt);
      pendingAdoption = null;
    }
    setGeneratingState(true);
    const adopt = (generated) => {
      pendingAdoption = null;
      if (token !== puzzleRequestToken) {
        returnPuzzleToPool(normalized, generated);
        return;
      }
      adoptPuzzle(normalized, generated);
    };
    pendingAdoption = { difficulty: normalized, adopt };
    withPuzzle(normalized, adopt);
  };

  // --- keyboard --------------------------------------------------------------

  const handleCellKeydown = (event, cell) => {
    const index = Number(cell.dataset.sudokuIndex);
    if (!Number.isInteger(index)) return;
    const row = Math.floor(index / 9);
    const column = index % 9;
    const moves = {
      ArrowUp: Math.max(0, row - 1) * 9 + column,
      ArrowDown: Math.min(8, row + 1) * 9 + column,
      ArrowLeft: row * 9 + Math.max(0, column - 1),
      ArrowRight: row * 9 + Math.min(8, column + 1),
    };
    if (event.key in moves) {
      event.preventDefault();
      focusCell(moves[event.key]);
      return;
    }
    if (DIGITS.includes(event.key) && event.key.length === 1) {
      event.preventDefault();
      state.selectedIndex = index;
      selectCell(cell);
      applyDigitToCell(cell, index, event.key);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      state.selectedIndex = index;
      selectCell(cell);
      clearCellValueOrNotes(cell, index);
    }
  };

  const cellFromEvent = (event) => {
    const cell = event.target.closest?.(".sudoku-cell");
    return cell && grid.contains(cell) ? cell : null;
  };

  const handleGridClick = (event) => {
    const cell = cellFromEvent(event);
    if (cell) focusCell(Number(cell.dataset.sudokuIndex));
  };

  const handleGridFocus = (event) => {
    const cell = cellFromEvent(event);
    if (cell) selectCell(cell);
  };

  const handleGridKeydown = (event) => {
    if (isBoardLocked()) return;
    const cell = cellFromEvent(event);
    if (cell) handleCellKeydown(event, cell);
  };

  const handleUndoRedoShortcut = (event) => {
    const isUndoKey = event.key === "z" || event.key === "Z";
    const isRedoKey = event.key === "y" || event.key === "Y";
    if (isBoardLocked() || (!event.metaKey && !event.ctrlKey) || event.altKey) return false;
    if (!isUndoKey && !isRedoKey) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.matches("input, textarea, select")) return false;
    event.preventDefault();
    if (isRedoKey || event.shiftKey) redoMove();
    else undoMove();
    return true;
  };

  // Window-level keys: N toggles notes anywhere in the active Sudoku window,
  // and digits or clear keys edit the selected cell even while a keypad or
  // action button holds focus. The grid keeps its own digit handling, which
  // marks those events as handled before they reach the document.
  const handleWindowKeydown = (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!state.playing || isBoardLocked()) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.matches("input, textarea, select, [contenteditable='true']")) return false;
    if (event.key === "n" || event.key === "N") {
      if (event.repeat) return false;
      event.preventDefault();
      setNoteMode(!state.noteMode);
      return true;
    }
    if (target && grid.contains(target)) return false;
    const cell = selectedCell();
    if (!cell || cell.readOnly) return false;
    const index = Number(cell.dataset.sudokuIndex);
    if (!Number.isInteger(index)) return false;
    if (DIGITS.includes(event.key) && event.key.length === 1) {
      event.preventDefault();
      applyDigitToCell(cell, index, event.key);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      clearCellValueOrNotes(cell, index);
      return true;
    }
    return false;
  };

  // --- notes tooltip -----------------------------------------------------------

  const ensureNoteTooltip = () => {
    if (noteTooltip) return noteTooltip;
    noteTooltip = document.createElement("span");
    noteTooltip.className = "sudoku-key-tooltip";
    noteTooltip.id = "sudoku-note-tooltip";
    noteTooltip.setAttribute("role", "tooltip");
    noteTooltip.textContent = NOTE_SHORTCUT_HINT;
    document.body.append(noteTooltip);
    return noteTooltip;
  };

  const positionTooltip = (tooltip, pointer) => {
    const offset = 12;
    const minEdge = 4;
    tooltip.style.left = `${pointer.clientX + offset}px`;
    tooltip.style.top = `${pointer.clientY + offset}px`;
    const bounds = tooltip.getBoundingClientRect();
    const left = Math.min(pointer.clientX + offset, window.innerWidth - bounds.width - minEdge);
    const top = Math.min(pointer.clientY + offset, window.innerHeight - bounds.height - minEdge);
    tooltip.style.left = `${Math.max(minEdge, left)}px`;
    tooltip.style.top = `${Math.max(minEdge, top)}px`;
  };

  const hideNoteTooltip = () => {
    noteTooltip?.classList.remove("is-visible");
  };

  const showNoteTooltip = (event) => {
    if (event.pointerType === "touch") return;
    const tooltip = ensureNoteTooltip();
    tooltip.classList.add("is-visible");
    positionTooltip(tooltip, event);
  };

  // --- wiring ----------------------------------------------------------------

  difficultyButtons.forEach((button) => {
    button.addEventListener("click", () => loadDifficulty(button.dataset.sudokuDifficulty));
  });
  numberButtons.forEach((button) => {
    button.addEventListener("click", () => applyNumber(button.dataset.sudokuNumber || ""));
  });
  hintButtons.forEach((button) => {
    button.addEventListener("click", () => setHintMode(button.dataset.sudokuHint || "off"));
  });
  ensureNoteTooltip();
  noteToggle.addEventListener("click", () => setNoteMode(!state.noteMode));
  noteToggle.addEventListener("pointerenter", showNoteTooltip);
  noteToggle.addEventListener("pointermove", showNoteTooltip);
  noteToggle.addEventListener("pointerleave", hideNoteTooltip);
  undoButton.addEventListener("click", undoMove);
  redoButton.addEventListener("click", redoMove);
  newButton.addEventListener("click", () => loadDifficulty(state.difficulty));
  checkButton.addEventListener("click", checkBoard);
  pauseButton.addEventListener("click", () => setPaused(true));
  resumeButton.addEventListener("click", () => setPaused(false));
  playButton.addEventListener("click", startGameFromBoot);
  grid.addEventListener("click", handleGridClick);
  grid.addEventListener("focusin", handleGridFocus);
  grid.addEventListener("keydown", handleGridKeydown);
  solveOk.addEventListener("click", hideSolvePopup);
  errorsCancel.addEventListener("click", () => hideErrorsPrompt());
  errorsConfirm.addEventListener("click", confirmErrors);
  errorsPrompt.addEventListener("keydown", trapErrorsPromptFocus);
  errorsPrompt.addEventListener("cancel", (event) => {
    event.preventDefault();
    hideErrorsPrompt();
  });
  solvePopup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideSolvePopup();
    }
  });
  registerKeyHandler(APP_ID, handleUndoRedoShortcut);
  registerKeyHandler(APP_ID, handleWindowKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", syncAquariumActivity);
  window.addEventListener("blur", syncAquariumActivity);
  reducedMotionQuery?.addEventListener?.("change", syncAquariumActivity);

  // With nothing to restore the board renders empty and stays that way until
  // Sudoku is opened: the first puzzle is generated like any other, off-thread.
  puzzleReady = restoreSavedState();
  renderGrid();

  return Object.freeze({
    open: startBootSequence,
    close: () => {
      clearBootSequence();
      pauseTimer();
    },
    resize: () => {
      if (app.classList.contains("is-sudoku-playing")) scheduleWindowClamp();
    },
  });
};

let controller = null;

export default {
  id: APP_ID,
  title: "Sudoku",
  icon: "assets/app-icons/ico/calendar2.ico",
  description: "Sudoku with six difficulties, pencil marks, hints, pause and local best times.",
  styles: ["apps/sudoku/sudoku.css"],
  window: {
    className: "sudoku-window",
    controls: ["minimize", "close"],
    center: true,
  },
  render,
  mount({ window: win }) {
    controller = createController(win);
  },
  onOpen() {
    controller.open();
  },
  onClose() {
    controller.close();
  },
  onResize() {
    controller.resize();
  },
};
