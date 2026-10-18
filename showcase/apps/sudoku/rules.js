// Sudoku rules and puzzle generation, free of the DOM so node tests can import
// them. index.js asks this module to decide and apply every move, and the
// generator worker asks it to carve puzzles; nothing here touches a window.

export const DIGITS = "123456789";
export const CELL_COUNT = 81;
export const UNIT_SIZE = 9;
export const BLANK = "0";
export const MAX_UNDO_STATES = 80;
export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard", "expert", "master", "extreme"]);
export const HINT_MODES = Object.freeze(["off", "conflicts", "errors"]);

/** Clue targets per difficulty; fewer clues means a harder carve. */
export const GENERATOR_CLUES = Object.freeze({
  easy: 42,
  medium: 36,
  hard: 32,
  expert: 28,
  master: 26,
  extreme: 24,
});

export const GENERATOR_MAX_ATTEMPTS = 3;

/** One shipped puzzle per difficulty, used when the worker cannot run. */
export const STATIC_PUZZLES = Object.freeze({
  easy: Object.freeze({
    puzzle: "402030000795020003001705400100004005609000000248507310900108500800050071017043092",
    solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892",
  }),
  medium: Object.freeze({
    puzzle: "000030007000026000300095426003900060650310048208067010920170000004250000510640090",
    solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892",
  }),
  hard: Object.freeze({
    puzzle: "060830000090000080381705400173080260600000708008500300000100004800250001510000092",
    solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892",
  }),
  expert: Object.freeze({
    puzzle: "002831000005400080001095406070000005059002000008060009906070530030000071000040090",
    solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892",
  }),
  master: Object.freeze({
    puzzle: "400031050000006000380000400000080060009000000000067019006008004800209000507600002",
    solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892",
  }),
  extreme: Object.freeze({
    puzzle: "600000010400000000020000000000050407008040300001090000300400200050100000000806009",
    solution: "693784512487512936125963874932651487568247391741398625319475268856129743274836159",
  }),
});

const FULL_DIGIT_MASK = 0b1111111110;

export class GameRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

const fail = (message, code = "invalid-move") => {
  throw new GameRuleError(code, message);
};

export const assertInteger = (value, minimum, maximum, label = "value") => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`Invalid ${label}`, "invalid-input");
  }
  return value;
};

const assertObject = (value, allowedKeys, label = "object") => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    fail(`Invalid ${label}`, "invalid-input");
  }
  return value;
};

const boxIndex = (row, column) => Math.floor(row / 3) * 3 + Math.floor(column / 3);

/** The other twenty cells sharing a row, column or box with each index. */
export const PEERS = Object.freeze(
  Array.from({ length: CELL_COUNT }, (unused, index) => {
    const row = Math.floor(index / UNIT_SIZE);
    const column = index % UNIT_SIZE;
    const box = boxIndex(row, column);
    return Object.freeze(
      Array.from({ length: CELL_COUNT }, (ignored, other) => other).filter((other) => {
        if (other === index) return false;
        const otherRow = Math.floor(other / UNIT_SIZE);
        const otherColumn = other % UNIT_SIZE;
        return otherRow === row || otherColumn === column || boxIndex(otherRow, otherColumn) === box;
      })
    );
  })
);

/**
 * Exactly one digit, one to nine. `DIGITS.includes(value)` alone is substring
 * matching and would accept "" or "89", so the length is part of the test.
 */
export const assertDigit = (value, label = "digit") => {
  if (typeof value !== "string" || value.length !== 1 || !DIGITS.includes(value)) {
    fail(`Invalid ${label}`, "invalid-input");
  }
  return value;
};

export const assertGrid = (value, label = "grid") => {
  if (
    typeof value !== "string" ||
    value.length !== CELL_COUNT ||
    !Array.from(value).every((digit) => digit === BLANK || DIGITS.includes(digit))
  ) {
    fail(`Invalid ${label}`, "invalid-input");
  }
  return value;
};

const assertDifficulty = (value) =>
  DIFFICULTIES.includes(value) ? value : fail("Unknown Sudoku difficulty", "invalid-input");

/** Nine distinct digits in every row, column and box, with no blanks left. */
export const isCompleteSolution = (grid) => {
  if (typeof grid !== "string" || grid.length !== CELL_COUNT || grid.includes(BLANK)) return false;
  for (let unit = 0; unit < UNIT_SIZE; unit += 1) {
    let rowMask = 0;
    let columnMask = 0;
    let boxMask = 0;
    for (let offset = 0; offset < UNIT_SIZE; offset += 1) {
      rowMask |= 1 << Number(grid[unit * UNIT_SIZE + offset]);
      columnMask |= 1 << Number(grid[offset * UNIT_SIZE + unit]);
      const box =
        (Math.floor(unit / 3) * 3 + Math.floor(offset / 3)) * UNIT_SIZE + (unit % 3) * 3 + (offset % 3);
      boxMask |= 1 << Number(grid[box]);
    }
    if (rowMask !== FULL_DIGIT_MASK || columnMask !== FULL_DIGIT_MASK || boxMask !== FULL_DIGIT_MASK) {
      return false;
    }
  }
  return true;
};

/** Whether `solution` is a complete grid that agrees with every given in `puzzle`. */
export const solutionMatchesPuzzle = (puzzle, solution) =>
  typeof puzzle === "string" &&
  puzzle.length === CELL_COUNT &&
  isCompleteSolution(solution) &&
  Array.from(puzzle).every((digit, index) => digit === BLANK || digit === solution[index]);

const isGiven = (state, index) => state.puzzle[index] !== BLANK;

export const normalizeNotes = (value) =>
  Array.from(new Set(Array.from(typeof value === "string" ? value : "")))
    .filter((digit) => DIGITS.includes(digit))
    .sort()
    .join("");

const normalizeNoteList = (raw, puzzle) => {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > CELL_COUNT) fail("Invalid notes", "invalid-input");
  return Array.from({ length: CELL_COUNT }, (unused, index) =>
    puzzle[index] === BLANK ? normalizeNotes(list[index]) : ""
  );
};

const withDigit = (grid, index, digit) => {
  const next = `${grid.slice(0, index)}${digit}${grid.slice(index + 1)}`;
  if (next.length !== CELL_COUNT) fail("A Sudoku board holds 81 cells", "invalid-input");
  return next;
};

/** Every entry that disagrees with the solution. Givens cannot be wrong. */
export const evaluate = (state) => {
  assertGrid(state.values, "board");
  const wrong = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = state.values[index];
    if (value === BLANK || isGiven(state, index)) continue;
    if (value !== state.solution[index]) wrong.push(index);
  }
  return {
    complete: !state.values.includes(BLANK),
    mistakes: wrong.length,
    valid: wrong.length === 0,
    wrong,
  };
};

/**
 * Every index holding a value that repeats inside its own row, column or box,
 * givens included. This reads the board and never the solution, so a marked
 * pair says only that both cannot stand, never which one is wrong.
 */
export const conflictIndexes = (state) => {
  const units = new Map();
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = state.values[index];
    if (value === BLANK) continue;
    const row = Math.floor(index / UNIT_SIZE);
    const column = index % UNIT_SIZE;
    for (const unit of [`r${row}`, `c${column}`, `b${boxIndex(row, column)}`]) {
      const key = `${unit}:${value}`;
      const members = units.get(key);
      if (members) members.push(index);
      else units.set(key, [index]);
    }
  }
  const conflicts = [];
  units.forEach((members) => {
    if (members.length > 1) conflicts.push(...members);
  });
  return Array.from(new Set(conflicts)).sort((left, right) => left - right);
};

/**
 * Errors mode is the only thing that marks a wrong value, and the assistance
 * latch flips the first time it marks one. Outside Errors mode the mistake
 * count reads zero.
 */
const refreshHintFeedback = (state) => {
  if (state.hintMode !== "errors") {
    state.mistakes = 0;
    return;
  }
  const { mistakes } = evaluate(state);
  state.mistakes = mistakes;
  if (mistakes > 0) state.usedHint = true;
};

const historyEntry = (state) => ({
  values: state.values,
  notes: state.notes.slice(),
  selectedIndex: state.selectedIndex,
});

const sameEntry = (first, second) =>
  Boolean(
    first &&
      second &&
      first.selectedIndex === second.selectedIndex &&
      first.values === second.values &&
      first.notes.join("|") === second.notes.join("|")
  );

const pushUndo = (state) => {
  const entry = historyEntry(state);
  if (sameEntry(entry, state.undo[state.undo.length - 1])) return;
  state.undo.push(entry);
  if (state.undo.length > MAX_UNDO_STATES) state.undo.shift();
  state.redo = [];
};

const applyHistoryEntry = (state, entry) => {
  state.values = entry.values;
  state.notes = entry.notes.slice();
  state.selectedIndex = entry.selectedIndex;
  state.solved = false;
  refreshHintFeedback(state);
};

/** Validates a puzzle (fresh or restored) and returns the working state. */
export const initial = (rawInitial) => {
  const raw = assertObject(
    rawInitial,
    [
      "difficulty",
      "puzzle",
      "solution",
      "values",
      "notes",
      "selectedIndex",
      "hintMode",
      "noteMode",
      "errorsConfirmed",
      "usedHint",
      "moves",
      "solved",
    ],
    "Sudoku initial state"
  );
  const puzzle = assertGrid(raw.puzzle, "puzzle");
  const solution = assertGrid(raw.solution, "solution");
  if (!isCompleteSolution(solution)) fail("The solution is not a complete grid", "invalid-input");
  if (!solutionMatchesPuzzle(puzzle, solution)) {
    fail("The puzzle does not agree with its solution", "invalid-input");
  }
  if (puzzle === solution) fail("The puzzle has nothing left to solve", "invalid-input");
  const values = Array.from(assertGrid(raw.values ?? puzzle, "values"));
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (puzzle[index] !== BLANK && values[index] !== puzzle[index]) {
      fail("A given cannot be overwritten", "invalid-input");
    }
  }
  const hintMode = raw.hintMode ?? "off";
  if (!HINT_MODES.includes(hintMode)) fail("Unknown Sudoku hint mode", "invalid-input");
  const state = {
    difficulty: assertDifficulty(raw.difficulty),
    puzzle,
    solution,
    values: values.join(""),
    notes: normalizeNoteList(raw.notes, puzzle),
    selectedIndex: assertInteger(raw.selectedIndex ?? -1, -1, CELL_COUNT - 1, "selected cell"),
    hintMode,
    noteMode: Boolean(raw.noteMode ?? false),
    errorsConfirmed: Boolean(raw.errorsConfirmed ?? false),
    usedHint: Boolean(raw.usedHint ?? false),
    moves: assertInteger(raw.moves ?? 0, 0, 100_000, "move count"),
    mistakes: 0,
    solved: false,
    undo: [],
    redo: [],
  };
  if (state.hintMode === "errors" && !state.errorsConfirmed) {
    fail("Errors mode needs its confirmation", "invalid-input");
  }
  // A restored board may claim to be finished, but only if it really is.
  if (raw.solved !== undefined && Boolean(raw.solved)) {
    const outcome = evaluate(state);
    if (!outcome.complete || !outcome.valid) fail("That board is not solved", "invalid-input");
    state.solved = true;
  }
  refreshHintFeedback(state);
  return state;
};

const assertEditable = (state, action) => {
  const index = assertInteger(action.index, 0, CELL_COUNT - 1, "cell");
  if (isGiven(state, index)) fail("A given cannot be edited");
  return index;
};

const afterEdit = (state) => {
  state.solved = false;
  state.moves += 1;
  refreshHintFeedback(state);
};

const OPERATIONS = Object.freeze({
  select: {
    keys: ["index"],
    check(state, action) {
      const index = assertInteger(action.index, -1, CELL_COUNT - 1, "cell");
      if (index === state.selectedIndex) fail("That cell is already selected");
    },
    apply(state, action) {
      state.selectedIndex = action.index;
    },
  },
  setValue: {
    keys: ["index", "value"],
    check(state, action) {
      const index = assertEditable(state, action);
      assertDigit(action.value, "cell digit");
      if (state.values[index] === action.value) fail("That digit is already there");
    },
    apply(state, action) {
      pushUndo(state);
      state.values = withDigit(state.values, action.index, action.value);
      // Placing a digit rules it out of its row, column and box, so the pencil
      // mark is stale the moment the value lands. Retiring it belongs to this
      // move: one undo puts the value and every cleared mark back together.
      for (const peer of PEERS[action.index]) {
        if (state.notes[peer].includes(action.value)) {
          state.notes[peer] = state.notes[peer].split(action.value).join("");
        }
      }
      afterEdit(state);
    },
  },
  clear: {
    keys: ["index"],
    check(state, action) {
      const index = assertEditable(state, action);
      if (state.values[index] === BLANK && !state.notes[index]) fail("That cell is already empty");
    },
    apply(state, action) {
      pushUndo(state);
      // Clearing an empty cell is how the keypad wipes its pencil marks.
      if (state.values[action.index] === BLANK) state.notes[action.index] = "";
      else state.values = withDigit(state.values, action.index, BLANK);
      afterEdit(state);
    },
  },
  toggleNote: {
    keys: ["index", "digit"],
    check(state, action) {
      const index = assertEditable(state, action);
      assertDigit(action.digit, "pencil mark");
      if (state.values[index] !== BLANK) fail("A filled cell holds no pencil marks");
    },
    apply(state, action) {
      pushUndo(state);
      const notes = state.notes[action.index];
      state.notes[action.index] = notes.includes(action.digit)
        ? notes.split(action.digit).join("")
        : normalizeNotes(`${notes}${action.digit}`);
      afterEdit(state);
    },
  },
  undo: {
    keys: [],
    check(state) {
      if (!state.undo.length) fail("There is nothing to undo");
    },
    apply(state) {
      const current = historyEntry(state);
      applyHistoryEntry(state, state.undo.pop());
      state.redo.push(current);
      if (state.redo.length > MAX_UNDO_STATES) state.redo.shift();
    },
  },
  redo: {
    keys: [],
    check(state) {
      if (!state.redo.length) fail("There is nothing to redo");
    },
    apply(state) {
      const current = historyEntry(state);
      applyHistoryEntry(state, state.redo.pop());
      state.undo.push(current);
      if (state.undo.length > MAX_UNDO_STATES) state.undo.shift();
    },
  },
  confirmErrors: {
    keys: [],
    check(state) {
      if (state.errorsConfirmed) fail("The Errors warning is already accepted");
    },
    apply(state) {
      state.errorsConfirmed = true;
    },
  },
  setHintMode: {
    keys: ["mode"],
    check(state, action) {
      if (!HINT_MODES.includes(action.mode)) fail("Unknown Sudoku hint mode", "invalid-input");
      if (action.mode === state.hintMode) fail("That hint mode is already on");
      if (action.mode === "errors" && !state.errorsConfirmed) {
        fail("Errors mode needs its confirmation first");
      }
    },
    apply(state, action) {
      state.hintMode = action.mode;
      refreshHintFeedback(state);
    },
  },
  setNoteMode: {
    keys: ["enabled"],
    check(state, action) {
      if (typeof action.enabled !== "boolean") fail("Note mode is a flag", "invalid-input");
      if (action.enabled === state.noteMode) fail("Note mode is already there");
    },
    apply(state, action) {
      state.noteMode = action.enabled;
    },
  },
  /** Check reports every mistake; a complete and correct board is solved. */
  check: {
    keys: [],
    check() {},
    apply(state) {
      const outcome = evaluate(state);
      if (outcome.complete && outcome.valid) {
        state.mistakes = 0;
        state.solved = true;
        return;
      }
      state.mistakes = outcome.mistakes;
    },
  },
});

/** Throws the exact reason `action` cannot be played, or returns its operation. */
const review = (state, action) => {
  const operation =
    OPERATIONS[action?.op] || fail(`Unknown Sudoku move: ${String(action?.op)}`, "invalid-input");
  assertObject(action, ["op", ...operation.keys], "Sudoku move");
  operation.check(state, action);
  return operation;
};

/** Applies `action` to `state` in place; throws a GameRuleError when refused. */
export const transition = (state, action) => {
  const operation = review(state, action);
  operation.apply(state, action);
  return state;
};

/** Whether `action` is playable now. The controller offers nothing else. */
export const canApply = (state, action) => {
  try {
    review(state, action);
    return true;
  } catch (error) {
    if (error instanceof GameRuleError) return false;
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Generation

export const shuffle = (items, random = Math.random) => {
  const shuffled = Array.from(items);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const countMaskBits = (mask) => {
  let count = 0;
  let remaining = mask;
  while (remaining) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
};

/** A filled grid, built by shuffling the bands, stacks and digits of one pattern. */
export const createFullSolution = (random = Math.random) => {
  const groups = [0, 1, 2];
  const rows = shuffle(groups, random).flatMap((band) => shuffle(groups, random).map((row) => band * 3 + row));
  const columns = shuffle(groups, random).flatMap((stack) =>
    shuffle(groups, random).map((column) => stack * 3 + column)
  );
  const digits = shuffle(DIGITS.split(""), random);
  const pattern = (row, column) => (row * 3 + Math.floor(row / 3) + column) % 9;
  return rows.flatMap((row) => columns.map((column) => digits[pattern(row, column)])).join("");
};

/**
 * Counts solutions of a grid (a string of digits and zeros, or an array of
 * numbers) up to `limit`. Carving only needs to know whether a second answer
 * exists, so the search stops as soon as it finds one.
 */
export const countSolutions = (grid, limit = 2) => {
  const board = typeof grid === "string" ? Array.from(grid, Number) : grid.slice();
  if (board.length !== CELL_COUNT) fail("A Sudoku board holds 81 cells", "invalid-input");
  const rowMasks = Array.from({ length: 9 }, () => 0);
  const columnMasks = Array.from({ length: 9 }, () => 0);
  const boxMasks = Array.from({ length: 9 }, () => 0);

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = board[index];
    if (!value) continue;
    const row = Math.floor(index / 9);
    const column = index % 9;
    const box = boxIndex(row, column);
    const digitMask = 1 << value;
    if (rowMasks[row] & digitMask || columnMasks[column] & digitMask || boxMasks[box] & digitMask) {
      return 0;
    }
    rowMasks[row] |= digitMask;
    columnMasks[column] |= digitMask;
    boxMasks[box] |= digitMask;
  }

  let solutions = 0;
  const solve = () => {
    if (solutions >= limit) return;
    let bestIndex = -1;
    let bestMask = 0;
    let bestOptionCount = 10;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (board[index]) continue;
      const row = Math.floor(index / 9);
      const column = index % 9;
      const box = boxIndex(row, column);
      const candidateMask = FULL_DIGIT_MASK & ~(rowMasks[row] | columnMasks[column] | boxMasks[box]);
      const optionCount = countMaskBits(candidateMask);
      if (!optionCount) return;
      if (optionCount < bestOptionCount) {
        bestIndex = index;
        bestMask = candidateMask;
        bestOptionCount = optionCount;
        if (optionCount === 1) break;
      }
    }
    if (bestIndex === -1) {
      solutions += 1;
      return;
    }
    const row = Math.floor(bestIndex / 9);
    const column = bestIndex % 9;
    const box = boxIndex(row, column);
    let candidateMask = bestMask;
    while (candidateMask && solutions < limit) {
      const digitMask = candidateMask & -candidateMask;
      const digit = Math.log2(digitMask);
      board[bestIndex] = digit;
      rowMasks[row] |= digitMask;
      columnMasks[column] |= digitMask;
      boxMasks[box] |= digitMask;
      solve();
      rowMasks[row] &= ~digitMask;
      columnMasks[column] &= ~digitMask;
      boxMasks[box] &= ~digitMask;
      board[bestIndex] = 0;
      candidateMask &= candidateMask - 1;
    }
  };

  solve();
  return solutions;
};

/**
 * Removes clues in a random order, keeping a removal only while the grid still
 * has one answer. Several attempts are made because a single carve can stall
 * above the clue target; the sparsest attempt wins.
 */
export const generatePuzzle = (targetClues, maxAttempts = GENERATOR_MAX_ATTEMPTS, random = Math.random) => {
  assertInteger(targetClues, 17, CELL_COUNT, "clue target");
  assertInteger(maxAttempts, 1, 50, "attempt limit");
  let best = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const solution = createFullSolution(random);
    const cells = Array.from(solution, Number);
    let clues = CELL_COUNT;
    for (const index of shuffle(Array.from({ length: CELL_COUNT }, (unused, cell) => cell), random)) {
      if (clues <= targetClues) break;
      const removed = cells[index];
      cells[index] = 0;
      if (countSolutions(cells, 2) === 1) {
        clues -= 1;
        continue;
      }
      cells[index] = removed;
    }
    const generated = { clues, puzzle: cells.join(""), solution };
    if (!best || clues < best.clues) best = generated;
    if (clues <= targetClues) return generated;
  }
  return best;
};
