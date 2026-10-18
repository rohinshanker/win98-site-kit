// Minesweeper rules: deterministic board generation (safe first click) and
// state transitions (reveal, mark, chord) with no DOM access. The window in
// index.js and the node tests both import this module.

export const CONFIGURATIONS = Object.freeze({
  beginner: Object.freeze({ cols: 9, rows: 9, mines: 10 }),
  intermediate: Object.freeze({ cols: 16, rows: 16, mines: 40 }),
  expert: Object.freeze({ cols: 30, rows: 16, mines: 99 }),
});

export const DIFFICULTIES = Object.freeze(Object.keys(CONFIGURATIONS));

export const MARKS = Object.freeze(["none", "flag", "question"]);

const MAX_WORK_BUDGET = 120_000_000;

/** Caps per game so a corrupt or hostile replay cannot run away. */
export const LIMITS = Object.freeze({ inputs: 16_384, work: 2_000_000 });

export class GameRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new GameRuleError(code, message);
};

export const assertInteger = (value, minimum, maximum, label = "value") => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid-input", `Invalid ${label}`);
  }
  return value;
};

export const assertObject = (value, allowedKeys, label = "object") => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    fail("invalid-input", `Invalid ${label}`);
  }
  return value;
};

/** Each transition charges primitive work against a budget. */
export const createBudget = (limit = LIMITS.work) => ({
  remaining: assertInteger(limit, 0, MAX_WORK_BUDGET, "work budget"),
  spend(units = 1) {
    assertInteger(units, 0, 10_000_000, "work charge");
    if (units > this.remaining) fail("replay-limit", "Game work limit exceeded");
    this.remaining -= units;
  },
});

/** Mulberry32: only `state.rngState` changes. */
export const nextRandom = (state) => {
  assertInteger(state.rngState, 0, 0xffffffff, "random state");
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let value = state.rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
};

export const randomIndex = (state, count, budget) => {
  assertInteger(count, 1, 4096, "random choice count");
  budget?.spend();
  return Math.floor(nextRandom(state) * count);
};

/** A fresh 32-bit seed from Math.random. */
export const randomSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

const configurationFor = (config, expanded = false) => {
  assertObject(
    config,
    expanded ? ["difficulty", "cols", "rows", "mines"] : ["difficulty"],
    "Minesweeper configuration"
  );
  const dimensions = CONFIGURATIONS[config.difficulty];
  if (!dimensions) fail("invalid-input", "Invalid Minesweeper difficulty");
  return { difficulty: config.difficulty, ...dimensions };
};

export const neighborsFor = (index, cols, rows, budget) => {
  const x = index % cols;
  const y = Math.floor(index / cols);
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      budget?.spend();
      if (dx === 0 && dy === 0) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= cols || nextY >= rows) continue;
      neighbors.push(nextY * cols + nextX);
    }
  }
  return neighbors;
};

/**
 * Lays out mines for `config.difficulty` so `firstCell` and its neighbours
 * are safe. The same seed and first cell always give the same layout.
 */
export const generate = (config, { seed, firstCell, budget } = {}) => {
  const configuration = configurationFor(config);
  const work = budget || createBudget();
  const cellCount = configuration.cols * configuration.rows;
  assertInteger(seed, 0, 0xffffffff, "Minesweeper seed");
  assertInteger(firstCell, 0, cellCount - 1, "Minesweeper first cell");
  const forbidden = new Set([
    firstCell,
    ...neighborsFor(firstCell, configuration.cols, configuration.rows, work),
  ]);
  const choices = [];
  for (let index = 0; index < cellCount; index += 1) {
    work.spend();
    if (!forbidden.has(index)) choices.push(index);
  }
  if (choices.length < configuration.mines) {
    fail("invalid-input", "Minesweeper configuration has no legal mine layout");
  }
  const rng = { rngState: seed };
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(rng, index + 1, work);
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return {
    configuration,
    firstCell,
    mineCells: choices.slice(0, configuration.mines).sort((left, right) => left - right),
  };
};

const validateRawInitial = (rawInitial) => {
  assertObject(rawInitial, ["configuration", "firstCell", "mineCells"], "Minesweeper initial state");
  const configuration = configurationFor(rawInitial.configuration, true);
  if (
    rawInitial.configuration.cols !== configuration.cols ||
    rawInitial.configuration.rows !== configuration.rows ||
    rawInitial.configuration.mines !== configuration.mines
  ) {
    fail("invalid-input", "Minesweeper configuration dimensions do not match difficulty");
  }
  const cellCount = configuration.cols * configuration.rows;
  assertInteger(rawInitial.firstCell, 0, cellCount - 1, "Minesweeper first cell");
  if (!Array.isArray(rawInitial.mineCells) || rawInitial.mineCells.length !== configuration.mines) {
    fail("invalid-input", "Invalid Minesweeper mine layout");
  }
  const mines = new Set();
  rawInitial.mineCells.forEach((index, position) => {
    assertInteger(index, 0, cellCount - 1, "Minesweeper mine cell");
    if (mines.has(index)) fail("invalid-input", "Duplicate Minesweeper mine cell");
    if (position && index < rawInitial.mineCells[position - 1]) {
      fail("invalid-input", "Minesweeper mine cells are not canonical");
    }
    mines.add(index);
  });
  const safeCells = [
    rawInitial.firstCell,
    ...neighborsFor(rawInitial.firstCell, configuration.cols, configuration.rows),
  ];
  for (const index of safeCells) {
    if (mines.has(index)) fail("invalid-input", "Minesweeper first cell is not protected");
  }
  return { configuration, mines };
};

/** Builds the playable state (cells with adjacency counts) from a layout. */
export const initial = (rawInitial) => {
  const { configuration, mines } = validateRawInitial(rawInitial);
  const cells = Array.from({ length: configuration.cols * configuration.rows }, (_, index) => ({
    mine: mines.has(index),
    adjacent: 0,
    revealed: false,
    mark: "none",
    blown: false,
    misflagged: false,
  }));
  cells.forEach((cell, index) => {
    if (cell.mine) return;
    cell.adjacent = neighborsFor(index, configuration.cols, configuration.rows).filter(
      (neighbor) => cells[neighbor].mine
    ).length;
  });
  return {
    configuration,
    firstCell: rawInitial.firstCell,
    cells,
    started: false,
    terminal: false,
    won: false,
    lost: false,
    revealedSafeCount: 0,
    flagCount: 0,
    moves: 0,
    nextSeq: 1,
  };
};

const revealMines = (state, budget) => {
  state.cells.forEach((cell) => {
    budget.spend();
    if (cell.mine) cell.revealed = true;
    else if (cell.mark === "flag") cell.misflagged = true;
  });
};

const finishWin = (state, budget) => {
  state.terminal = true;
  state.won = true;
  state.cells.forEach((cell) => {
    budget.spend();
    if (cell.mine) cell.mark = "flag";
  });
  state.flagCount = state.configuration.mines;
};

const revealFrom = (state, firstIndex, budget) => {
  const first = state.cells[firstIndex];
  if (first.revealed || first.mark === "flag") {
    fail("illegal-action", "Minesweeper cell cannot be revealed");
  }
  first.mark = "none";
  if (first.mine) {
    first.revealed = true;
    first.blown = true;
    state.terminal = true;
    state.lost = true;
    revealMines(state, budget);
    return;
  }
  const queue = [firstIndex];
  const queued = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const cell = state.cells[index];
    budget.spend();
    if (cell.revealed || cell.mark === "flag") continue;
    cell.mark = "none";
    cell.revealed = true;
    state.revealedSafeCount += 1;
    if (cell.adjacent !== 0) continue;
    neighborsFor(index, state.configuration.cols, state.configuration.rows, budget).forEach((neighbor) => {
      const next = state.cells[neighbor];
      if (!next.revealed && next.mark !== "flag" && !next.mine && !queued.has(neighbor)) {
        queue.push(neighbor);
        queued.add(neighbor);
      }
    });
  }
  if (state.revealedSafeCount === state.cells.length - state.configuration.mines) {
    finishWin(state, budget);
  }
};

const assertState = (state) => {
  if (!state || typeof state !== "object" || !Array.isArray(state.cells)) {
    fail("invalid-input", "Invalid Minesweeper state");
  }
  return state;
};

/**
 * Applies one action in place and returns the state. Actions are
 * `{ seq, op: "reveal" | "chord", cell }` or `{ seq, op: "mark", cell, mark }`
 * with `seq` equal to `state.nextSeq`. Illegal moves throw a GameRuleError
 * whose `code` is `illegal-action`; a finished game throws `terminal`.
 */
export const transition = (state, input, budget) => {
  assertState(state);
  if (state.terminal) fail("terminal", "Minesweeper game is already over");
  const work = budget || createBudget();
  if (state.nextSeq > LIMITS.inputs) fail("replay-limit", "Minesweeper input limit exceeded");
  assertObject(input, ["seq", "op", "cell", "mark"], "Minesweeper action");
  if (input.seq !== state.nextSeq) fail("invalid-input", "Minesweeper action sequence is not contiguous");
  assertInteger(input.cell, 0, state.cells.length - 1, "Minesweeper cell");
  if (input.op === "reveal") {
    assertObject(input, ["seq", "op", "cell"], "Minesweeper reveal action");
    if (!state.started && input.cell !== state.firstCell) {
      fail("first-cell-mismatch", "Minesweeper first reveal does not match the generated board");
    }
    const target = state.cells[input.cell];
    if (target.revealed || target.mark === "flag") {
      fail("illegal-action", "Minesweeper cell cannot be revealed");
    }
    state.started = true;
    revealFrom(state, input.cell, work);
  } else if (input.op === "mark") {
    assertObject(input, ["seq", "op", "cell", "mark"], "Minesweeper mark action");
    const cell = state.cells[input.cell];
    if (cell.revealed) fail("illegal-action", "Revealed Minesweeper cells cannot be marked");
    if (!MARKS.includes(input.mark) || input.mark === cell.mark) {
      fail("illegal-action", "Invalid Minesweeper mark transition");
    }
    if (cell.mark === "flag") state.flagCount -= 1;
    cell.mark = input.mark;
    if (cell.mark === "flag") state.flagCount += 1;
  } else if (input.op === "chord") {
    assertObject(input, ["seq", "op", "cell"], "Minesweeper chord action");
    const cell = state.cells[input.cell];
    if (!cell.revealed || cell.adjacent === 0) {
      fail("illegal-action", "Minesweeper cell cannot be chorded");
    }
    const neighbors = neighborsFor(input.cell, state.configuration.cols, state.configuration.rows, work);
    let flagged = 0;
    for (const index of neighbors) {
      work.spend();
      if (state.cells[index].mark === "flag") flagged += 1;
    }
    if (flagged !== cell.adjacent) fail("illegal-action", "Minesweeper chord has wrong flag count");
    const covered = [];
    for (const index of neighbors) {
      work.spend();
      const neighbor = state.cells[index];
      if (!neighbor.revealed && neighbor.mark !== "flag") covered.push(index);
    }
    if (!covered.length) fail("illegal-action", "Minesweeper chord reveals no cells");
    for (const index of covered) {
      revealFrom(state, index, work);
      if (state.terminal) break;
    }
  } else {
    fail("invalid-input", "Invalid Minesweeper action");
  }
  state.moves += 1;
  state.nextSeq += 1;
  return state;
};

/** `{ terminal, won, lost, moves, difficulty }` for a state. */
export const result = (state) => {
  assertState(state);
  return {
    terminal: Boolean(state.terminal),
    won: Boolean(state.won),
    lost: Boolean(state.lost),
    moves: state.moves,
    difficulty: state.configuration.difficulty,
  };
};

/** Generates and initialises a fresh board for a first click. */
export const newBoard = (difficulty, firstCell, seed = randomSeed()) =>
  initial(generate({ difficulty }, { seed, firstCell }));
