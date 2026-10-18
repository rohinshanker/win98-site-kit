// Minesweeper: the classic board at Beginner, Intermediate and Expert sizes
// with seven-segment mine and time counters, faces, S/D/F keyboard play
// (hover targeting), mobile mark buttons, right-click marks, chording,
// confetti on a win and local best times. Rules live in rules.js; counters
// and confetti in seven-segment.js; the controls help window is the extra
// window below.

import {
  DIALOG_INITIAL_FOCUS_SELECTOR,
  bringToFront,
  clamp,
  closeWindow,
  escapeHtml,
  flashBanner,
  formatElapsedTime,
  getWindow,
  isWindowOpen,
  onViewportResize,
  openWindow,
  preloadMediaSource,
  setFocusReturn,
  storage,
} from "../../kit/index.js";
import { CONFIGURATIONS, DIFFICULTIES, newBoard, result as resultOf, transition } from "./rules.js";
import {
  COUNTER_MAX,
  createConfetti,
  digitSources,
  formatSevenSegmentCounter,
  setSevenSegmentCounter,
} from "./seven-segment.js";

const ID = "minesweeper";
const CONTROLS_ID = "minesweeper-controls";
const ASSETS = "assets/minesweeper";
const BEST_TIMES_KEY = "win98SiteKit.minesweeper.bestTimes";
const TIMER_INTERVAL_MS = 1000;
const CONFETTI_PIECE_COUNT = 120;
const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Minesweeper_(video_game)";
const KEYBOARD_ACTIONS = Object.freeze({ s: "click", d: "question", f: "flag" });
const CONTROL_MODES = Object.freeze(["keyboard", "mobile", "mouse"]);
const DIFFICULTY_LABELS = Object.freeze({
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
});
const DIGIT_SOURCES = digitSources(ASSETS);
const CELL_NUMBER_SOURCES = Object.freeze(
  Array.from({ length: 8 }, (_, index) => `${ASSETS}/cell_numbers/cell_${index + 1}.png`)
);

const counterHtml = (id, label) => `
  <div class="ms-counter" id="${id}" aria-label="${label}">
    <img class="ms-digit" src="${DIGIT_SOURCES[0]}" alt="" />
    <img class="ms-digit" src="${DIGIT_SOURCES[0]}" alt="" />
    <img class="ms-digit" src="${DIGIT_SOURCES[0]}" alt="" />
  </div>`;

const difficultyOptionsHtml = () =>
  DIFFICULTIES.map((difficulty) => {
    const { cols, rows, mines } = CONFIGURATIONS[difficulty];
    return `<option value="${difficulty}">${DIFFICULTY_LABELS[difficulty]} ${cols}x${rows} (${mines} mines)</option>`;
  }).join("");

const gameHtml = () => `
  <div class="ms-app" aria-label="Minesweeper game">
    <div class="ms-lose-banner" id="ms-lose-banner" aria-hidden="true">
      <img data-src="${ASSETS}/minesweeper-you-lose-640.png" decoding="async" alt="You Lose" />
    </div>
    <div class="ms-top-panel">
      ${counterHtml("ms-mines", "Mines remaining")}
      <button
        class="ms-mark-control"
        id="ms-flag-mode"
        type="button"
        data-ms-mark-mode="flag"
        aria-label="Toggle flag placement mode"
        aria-pressed="false"
        title="Toggle flag placement mode"
        hidden
      ></button>
      <button class="ms-reset" id="ms-reset" data-face="smile" type="button" aria-label="New game"></button>
      <button
        class="ms-mark-control"
        id="ms-question-mode"
        type="button"
        data-ms-mark-mode="question"
        aria-label="Toggle question-mark placement mode"
        aria-pressed="false"
        title="Toggle question-mark placement mode"
        hidden
      ></button>
      ${counterHtml("ms-time", "Elapsed time")}
    </div>
    <div class="ms-board">
      <div class="ms-grid" id="ms-grid" role="grid" aria-label="Minesweeper grid" aria-keyshortcuts="S D F"></div>
    </div>
    <div class="ms-footer">
      <select id="ms-controls-mode" aria-label="Control mode">
        <option value="keyboard" selected>Keyboard Controls (S/D/F)</option>
        <option value="mobile">Mobile Controls</option>
        <option value="mouse">Click/Rt Click Only</option>
      </select>
      <label aria-label="Difficulty">
        <select id="ms-difficulty">${difficultyOptionsHtml()}</select>
      </label>
    </div>
    <div class="status-bar ms-status">
      <p class="status-bar-field" id="ms-best" aria-live="polite">Best Beginner: —</p>
    </div>
  </div>`;

const controlsHtml = () => `
  <p class="ms-controls-target-note" id="ms-controls-target-note">
    The current square is the square under your mouse pointer.
  </p>
  <ul class="ms-controls-list">
    <li>
      <img data-src="assets/app-icons/ico/mouse_ms.ico" width="20" height="20" alt="" aria-hidden="true" />
      <span>Press <kbd>S</kbd> to click the current square.</span>
    </li>
    <li>
      <img data-src="${ASSETS}/tiles/tile_question.png" width="20" height="20" alt="" aria-hidden="true" />
      <span>Press <kbd>D</kbd> to maybe the current square.</span>
    </li>
    <li>
      <img data-src="${ASSETS}/tiles/tile_flag.png" width="20" height="20" alt="" aria-hidden="true" />
      <span>Press <kbd>F</kbd> to flag the current square.</span>
    </li>
  </ul>`;

const state = {
  cols: 9,
  rows: 9,
  mines: 10,
  cells: [],
  elements: [],
  started: false,
  gameOver: false,
  timerId: null,
  timerSync: null,
  elapsedMs: 0,
  elapsed: 0,
  flagCount: 0,
  markMode: null,
  engine: null,
  pendingInputs: [],
  completionHandled: false,
};

/** DOM references, filled by mount(). */
const ui = {
  window: null,
  grid: null,
  board: null,
  mines: null,
  time: null,
  reset: null,
  flagMode: null,
  questionMode: null,
  controlsMode: null,
  difficulty: null,
  loseBanner: null,
  best: null,
  help: null,
  achievement: null,
  confetti: null,
};

const currentDifficulty = () =>
  DIFFICULTIES.includes(ui.difficulty?.value) ? ui.difficulty.value : "beginner";

// ------------------------------------------------------------ best times

const readBestTimes = () => {
  const stored = storage.readJson(BEST_TIMES_KEY, {});
  const times = {};
  for (const difficulty of DIFFICULTIES) {
    const value = stored && typeof stored === "object" ? stored[difficulty] : null;
    times[difficulty] = Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return times;
};

const renderBestTime = (difficulty, { isNew = false } = {}) => {
  if (!ui.best) return;
  const best = readBestTimes()[difficulty];
  const label = DIFFICULTY_LABELS[difficulty];
  const time = best === null ? "—" : formatElapsedTime(best);
  ui.best.textContent = isNew ? `New best ${label}: ${time}!` : `Best ${label}: ${time}`;
  ui.best.classList.toggle("is-new-record", isNew);
};

/** Stores `seconds` when it beats the saved time; returns whether it did. */
const recordBestTime = (difficulty, seconds) => {
  const times = readBestTimes();
  const best = times[difficulty];
  if (best !== null && best <= seconds) return false;
  times[difficulty] = seconds;
  storage.writeJson(BEST_TIMES_KEY, times);
  return true;
};

// ------------------------------------------------------------- rendering

const updateCounters = () => {
  setSevenSegmentCounter(ui.mines, formatSevenSegmentCounter(state.mines - state.flagCount), DIGIT_SOURCES);
  setSevenSegmentCounter(ui.time, formatSevenSegmentCounter(state.elapsed), DIGIT_SOURCES);
};

const setFace = (face) => {
  ui.reset?.setAttribute("data-face", face);
};

const cellStateLabel = (cell) => {
  if (cell.misflagged) return "incorrectly flagged";
  if (cell.revealed && cell.mine) return cell.blown ? "triggered mine" : "mine";
  if (cell.revealed && cell.adjacent > 0) {
    return `${cell.adjacent} adjacent ${cell.adjacent === 1 ? "mine" : "mines"}`;
  }
  if (cell.revealed) return "revealed empty";
  if (cell.flagged) return "flagged";
  if (cell.question) return "maybe";
  return "covered";
};

const renderCell = (index) => {
  const cell = state.cells[index];
  const el = state.elements[index];
  if (!cell || !el) return;
  const row = Math.floor(index / state.cols) + 1;
  const column = (index % state.cols) + 1;
  el.setAttribute("aria-label", `Row ${row}, column ${column}: ${cellStateLabel(cell)}`);
  el.className = "ms-cell";
  el.removeAttribute("data-number");
  el.textContent = "";
  if (cell.misflagged) {
    el.classList.add("is-mine-wrong");
    return;
  }
  if (cell.revealed) {
    el.classList.add("is-revealed");
    if (cell.mine) {
      el.classList.add("is-mine");
      if (cell.blown) el.classList.add("is-blown");
    } else if (cell.adjacent > 0) {
      el.setAttribute("data-number", String(cell.adjacent));
    }
    return;
  }
  if (cell.flagged) el.classList.add("is-flagged");
  else if (cell.question) el.classList.add("is-question");
};

const renderAll = () => {
  state.cells.forEach((_, index) => renderCell(index));
  updateCounters();
};

const buildGrid = () => {
  const grid = ui.grid;
  grid.innerHTML = "";
  state.elements = [];
  grid.setAttribute("aria-rowcount", String(state.rows));
  grid.setAttribute("aria-colcount", String(state.cols));
  grid.style.gridTemplateColumns = `repeat(${state.cols}, var(--ms-cell-size))`;
  grid.style.gridTemplateRows = `repeat(${state.rows}, var(--ms-cell-size))`;
  // A grid exposes its cells through rows; `.ms-row` is `display: contents`
  // so the board stays one CSS grid of cells.
  for (let row = 0; row < state.rows; row += 1) {
    const rowElement = document.createElement("div");
    rowElement.className = "ms-row";
    rowElement.setAttribute("role", "row");
    rowElement.setAttribute("aria-rowindex", String(row + 1));
    for (let col = 0; col < state.cols; col += 1) {
      const index = row * state.cols + col;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ms-cell";
      button.setAttribute("data-index", String(index));
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-rowindex", String(row + 1));
      button.setAttribute("aria-colindex", String(col + 1));
      button.setAttribute("aria-label", `Row ${row + 1}, column ${col + 1}: covered`);
      rowElement.appendChild(button);
      state.elements.push(button);
    }
    grid.appendChild(rowElement);
  }
};

const updateBoardAlignment = () => {
  if (!ui.board || !ui.grid) return;
  ui.board.classList.toggle("is-overflowing", ui.grid.scrollWidth > ui.board.clientWidth);
};

// ---------------------------------------------------------------- modes

const setMarkMode = (mode) => {
  const nextMode = mode === "flag" || mode === "question" ? mode : null;
  state.markMode = state.markMode === nextMode ? null : nextMode;
  for (const button of [ui.flagMode, ui.questionMode]) {
    const isActive = button.dataset.msMarkMode === state.markMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
};

const setMobileControlsVisible = (isVisible) => {
  for (const button of [ui.flagMode, ui.questionMode]) button.hidden = !isVisible;
  if (!isVisible) setMarkMode(null);
};

const setControlsMode = (mode) => {
  const nextMode = CONTROL_MODES.includes(mode) ? mode : "keyboard";
  ui.controlsMode.value = nextMode;
  setMobileControlsVisible(nextMode === "mobile");
  if (nextMode === "keyboard") ui.grid.setAttribute("aria-keyshortcuts", "S D F");
  else ui.grid.removeAttribute("aria-keyshortcuts");
};

// ---------------------------------------------------------------- timer

const readTimerClocks = () => ({ monotonic: performance.now(), wall: Date.now() });

/**
 * Accumulates real elapsed time since the previous sync, taking whichever
 * clock advanced further: the monotonic clock ignores device clock changes
 * but can pause during sleep; the wall clock covers sleep but can jump
 * backwards, which counts as no advance. Returns whether the shown value changed.
 */
const syncElapsed = () => {
  if (state.timerSync === null) return false;
  const clocks = readTimerClocks();
  state.elapsedMs += Math.max(
    clocks.monotonic - state.timerSync.monotonic,
    clocks.wall - state.timerSync.wall,
    0
  );
  state.timerSync = clocks;
  const elapsed = clamp(Math.floor(state.elapsedMs / TIMER_INTERVAL_MS), state.elapsed, COUNTER_MAX);
  if (elapsed === state.elapsed) return false;
  state.elapsed = elapsed;
  return true;
};

const stopTimer = () => {
  if (syncElapsed()) updateCounters();
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
};

const startTimer = () => {
  stopTimer();
  state.timerSync = readTimerClocks();
  state.elapsedMs = 0;
  state.timerId = setInterval(() => {
    if (state.gameOver || !state.started) return;
    if (syncElapsed()) updateCounters();
  }, TIMER_INTERVAL_MS);
};

// --------------------------------------------------------------- engine

const syncEngineState = () => {
  const engine = state.engine;
  if (!engine) return;
  state.cols = engine.configuration.cols;
  state.rows = engine.configuration.rows;
  state.mines = engine.configuration.mines;
  state.started = engine.started;
  state.gameOver = engine.terminal;
  state.flagCount = engine.flagCount;
  state.cells = engine.cells.map((cell) => ({
    mine: cell.mine,
    adjacent: cell.adjacent,
    revealed: cell.revealed,
    flagged: cell.mark === "flag",
    question: cell.mark === "question",
    blown: cell.blown,
    misflagged: cell.misflagged,
  }));
};

const applyInput = (input) => {
  if (!state.engine) return false;
  transition(state.engine, { seq: state.engine.nextSeq, ...input });
  syncEngineState();
  return true;
};

/** Generates the board around the first click and replays marks made before it. */
const prepareBoard = (firstCell) => {
  if (state.engine) return;
  state.engine = newBoard(currentDifficulty(), firstCell);
  const pendingInputs = state.pendingInputs;
  state.pendingInputs = [];
  pendingInputs.forEach(applyInput);
  syncEngineState();
  renderAll();
};

const newGame = (difficulty) => {
  const config = CONFIGURATIONS[difficulty] || CONFIGURATIONS.beginner;
  state.cols = config.cols;
  state.rows = config.rows;
  state.mines = config.mines;
  state.cells = Array.from({ length: config.cols * config.rows }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    question: false,
    blown: false,
    misflagged: false,
    adjacent: 0,
  }));
  state.started = false;
  state.gameOver = false;
  state.timerSync = null;
  state.elapsedMs = 0;
  state.elapsed = 0;
  state.flagCount = 0;
  state.engine = null;
  state.pendingInputs = [];
  state.completionHandled = false;
  setFace("smile");
  stopTimer();
  ui.loseBanner.classList.remove("is-visible");
  ui.confetti?.stop();
  buildGrid();
  updateBoardAlignment();
  updateCounters();
  renderBestTime(currentDifficulty());
};

const finishGame = () => {
  const outcome = state.engine ? resultOf(state.engine) : null;
  if (!outcome?.terminal || state.completionHandled) return;
  state.completionHandled = true;
  stopTimer();
  if (outcome.lost) {
    setFace("lose");
    ui.loseBanner.classList.add("is-visible");
    syncEngineState();
    renderAll();
    return;
  }
  setFace("win");
  ui.confetti?.start();
  const difficulty = currentDifficulty();
  if (difficulty === "expert") flashBanner(ui.achievement);
  renderAll();
  renderBestTime(difficulty, { isNew: recordBestTime(difficulty, state.elapsed) });
};

// --------------------------------------------------------------- moves

const revealCell = (index) => {
  if (!state.engine || state.gameOver) return;
  const cell = state.cells[index];
  if (!cell || cell.revealed || cell.flagged) return;
  applyInput({ op: "reveal", cell: index });
  renderAll();
  finishGame();
};

const setCellMark = (index, mark) => {
  const cell = state.cells[index];
  if (!cell || cell.revealed || state.gameOver) return;
  if (cell.flagged === (mark === "flag") && cell.question === (mark === "question")) return;
  const input = { op: "mark", cell: index, mark };
  if (state.engine) {
    applyInput(input);
  } else {
    state.pendingInputs.push(input);
    const wasFlagged = cell.flagged;
    cell.flagged = mark === "flag";
    cell.question = mark === "question";
    if (cell.flagged !== wasFlagged) state.flagCount += cell.flagged ? 1 : -1;
  }
  renderCell(index);
  updateCounters();
};

/** Right-click cycle: covered -> flag -> question -> covered. */
const toggleFlag = (index) => {
  const cell = state.cells[index];
  if (!cell || cell.revealed || state.gameOver) return;
  setCellMark(index, cell.flagged ? "question" : cell.question ? "none" : "flag");
};

/** Direct toggle of one mark kind (D/F keys and the mobile buttons). */
const toggleMark = (index, mode) => {
  const cell = state.cells[index];
  if (!cell || cell.revealed || state.gameOver) return;
  if (mode === "flag") setCellMark(index, cell.flagged ? "none" : "flag");
  else if (mode === "question") setCellMark(index, cell.question ? "none" : "question");
};

const chord = (index) => {
  const cell = state.cells[index];
  if (!cell || !cell.revealed || cell.adjacent === 0 || state.gameOver) return;
  try {
    applyInput({ op: "chord", cell: index });
  } catch (error) {
    if (error?.code === "illegal-action") return;
    throw error;
  }
  renderAll();
  finishGame();
};

const handleLeftClick = (index) => {
  if (state.gameOver) return;
  const cell = state.cells[index];
  if (!cell) return;
  if (state.markMode) {
    toggleMark(index, state.markMode);
    return;
  }
  if (cell.revealed) {
    chord(index);
    return;
  }
  if (!state.started) {
    prepareBoard(index);
    if (state.gameOver) return;
    startTimer();
  }
  revealCell(index);
};

const cellIndexFrom = (event) => {
  const cell = event.target.closest(".ms-cell");
  if (!cell) return null;
  const index = Number(cell.getAttribute("data-index"));
  return Number.isInteger(index) ? index : null;
};

/** The keyboard target is only ever the cell under the mouse pointer. */
const keyboardTargetIndex = () => {
  const cell = ui.grid.querySelector(".ms-cell:hover");
  if (!cell) return null;
  const index = Number(cell.getAttribute("data-index"));
  if (!Number.isInteger(index) || state.elements[index] !== cell) return null;
  return index;
};

const handleKeydown = (event) => {
  const action = KEYBOARD_ACTIONS[event.key.toLowerCase()];
  if (!action) return false;
  if (
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    state.gameOver ||
    ui.controlsMode.value !== "keyboard"
  ) {
    return false;
  }
  const index = keyboardTargetIndex();
  if (index === null) return false;
  event.preventDefault();
  if (action === "click") handleLeftClick(index);
  else toggleMark(index, action);
  return true;
};

const isGameWindowShowing = () => isWindowOpen(ID) && ui.window?.getAttribute("aria-hidden") !== "true";

const openControlsWindow = () => {
  const controlsWindow = getWindow(CONTROLS_ID);
  setFocusReturn(controlsWindow, ui.help);
  openWindow(CONTROLS_ID);
  requestAnimationFrame(() => {
    controlsWindow?.querySelector(DIALOG_INITIAL_FOCUS_SELECTOR)?.focus({ preventScroll: true });
  });
};

// ---------------------------------------------------------------- mount

const createOverlay = (className, html = "") => {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
};

const bindGrid = () => {
  const grid = ui.grid;
  grid.addEventListener("click", (event) => {
    const index = cellIndexFrom(event);
    if (index !== null) handleLeftClick(index);
  });
  grid.addEventListener("dblclick", (event) => {
    const index = cellIndexFrom(event);
    if (index !== null) chord(index);
  });
  grid.addEventListener("contextmenu", (event) => {
    const index = cellIndexFrom(event);
    if (index === null) return;
    event.preventDefault();
    toggleFlag(index);
  });
  grid.addEventListener("pointerdown", (event) => {
    if (state.gameOver || state.markMode) return;
    const cell = event.target.closest(".ms-cell");
    if (!cell) return;
    setFace("ooh");
    cell.classList.add("is-pressed");
  });
  grid.addEventListener("pointerup", (event) => {
    if (!state.gameOver) setFace("smile");
    event.target.closest(".ms-cell")?.classList.remove("is-pressed");
  });
  grid.addEventListener("pointerleave", () => {
    if (!state.gameOver) setFace("smile");
    grid.querySelectorAll(".ms-cell.is-pressed").forEach((cell) => cell.classList.remove("is-pressed"));
  });
};

const bindControls = () => {
  ui.reset.addEventListener("click", () => newGame(currentDifficulty()));
  ui.reset.addEventListener("pointerdown", () => {
    if (!state.gameOver) setFace("pressed");
  });
  for (const type of ["pointerup", "pointerleave"]) {
    ui.reset.addEventListener(type, () => {
      if (!state.gameOver) setFace("smile");
    });
  }
  ui.flagMode.addEventListener("click", () => setMarkMode("flag"));
  ui.questionMode.addEventListener("click", () => setMarkMode("question"));
  ui.difficulty.addEventListener("change", () => newGame(ui.difficulty.value));
  ui.controlsMode.addEventListener("change", () => setControlsMode(ui.controlsMode.value));
  ui.help.addEventListener("click", openControlsWindow);
};

const mount = ({ window: win }) => {
  ui.window = win;
  ui.grid = win.querySelector("#ms-grid");
  ui.board = win.querySelector(".ms-board");
  ui.mines = win.querySelector("#ms-mines");
  ui.time = win.querySelector("#ms-time");
  ui.reset = win.querySelector("#ms-reset");
  ui.flagMode = win.querySelector("#ms-flag-mode");
  ui.questionMode = win.querySelector("#ms-question-mode");
  ui.controlsMode = win.querySelector("#ms-controls-mode");
  ui.difficulty = win.querySelector("#ms-difficulty");
  ui.loseBanner = win.querySelector("#ms-lose-banner");
  ui.best = win.querySelector("#ms-best");
  ui.help = win.querySelector('[data-window-control="help"]');
  ui.help.id = "ms-help";

  const canvas = document.createElement("canvas");
  canvas.className = "ms-confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ui.confetti = createConfetti(canvas, { pieceCount: CONFETTI_PIECE_COUNT });
  ui.achievement = createOverlay(
    "ms-achievement",
    `<img src="${ASSETS}/achievement.png" alt="${escapeHtml("Achievement unlocked")}" />`
  );

  bindGrid();
  bindControls();
  onViewportResize({
    onFrame: () => {
      ui.confetti.resize();
      updateBoardAlignment();
    },
  });
  setMarkMode(null);
  setControlsMode("keyboard");
  newGame("beginner");
};

export default {
  id: ID,
  title: "Minesweeper",
  icon: "assets/app-icons/ico/minesweeper.ico",
  styles: ["apps/minesweeper/minesweeper.css"],
  window: {
    className: "minesweeper-window",
    controls: ["help", "close"],
  },
  render: gameHtml,
  mount,
  onOpen() {
    for (const source of CELL_NUMBER_SOURCES) preloadMediaSource(source);
    updateBoardAlignment();
  },
  // Dismissing the board also puts the controls away and deals a fresh game,
  // so reopening never resumes a board the player walked away from.
  onClose() {
    closeWindow(CONTROLS_ID);
    newGame(currentDifficulty());
  },
  onResize() {
    updateBoardAlignment();
  },
  onKeydown: handleKeydown,
  windows: [
    {
      id: CONTROLS_ID,
      title: "Keyboard Controls",
      window: {
        className: "minesweeper-controls-window",
        controls: ["help", "close"],
        dialog: true,
      },
      render: controlsHtml,
      mount({ window: win }) {
        win.setAttribute("aria-describedby", "ms-controls-target-note");
        const wikipedia = win.querySelector('[data-window-control="help"]');
        wikipedia.id = "ms-controls-help";
        wikipedia.classList.add("help");
        wikipedia.setAttribute("aria-label", "Minesweeper Wikipedia");
        wikipedia.addEventListener("click", () => {
          window.open(WIKIPEDIA_URL, "_blank", "noopener,noreferrer");
        });
      },
      onClose() {
        if (isGameWindowShowing()) bringToFront(ui.window);
      },
    },
  ],
};
