// Pure-logic tests for the Minesweeper package: board generation with a safe
// first click, reveal cascades, marks, chording, win and loss detection,
// difficulty configurations and the seven-segment counter formatting.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONFIGURATIONS,
  DIFFICULTIES,
  GameRuleError,
  LIMITS,
  createBudget,
  generate,
  initial,
  neighborsFor,
  newBoard,
  result,
  transition,
} from "../../registry/games/minesweeper/apps/minesweeper/rules.js";
import {
  COUNTER_MAX,
  digitSources,
  formatSevenSegmentCounter,
} from "../../registry/games/minesweeper/apps/minesweeper/seven-segment.js";

const PACKAGE_DIR = new URL("../../registry/games/minesweeper/", import.meta.url);

const board = (difficulty = "beginner", firstCell = 40, seed = 1234) =>
  initial(generate({ difficulty }, { seed, firstCell }));

const act = (state, input) => transition(state, { seq: state.nextSeq, ...input });

const safeCells = (state) =>
  state.cells.map((cell, index) => (cell.mine ? null : index)).filter((index) => index !== null);

const mineCells = (state) =>
  state.cells.map((cell, index) => (cell.mine ? index : null)).filter((index) => index !== null);

/** Reveals every safe cell in order, skipping ones a cascade already opened. */
const revealAllSafe = (state) => {
  for (const index of safeCells(state)) {
    if (state.terminal) break;
    if (!state.cells[index].revealed) act(state, { op: "reveal", cell: index });
  }
  return state;
};

const expectRuleError = (fn, code) => {
  assert.throws(fn, (error) => error instanceof GameRuleError && error.code === code, `expected ${code}`);
};

test("difficulty configurations match the classic Windows layouts", () => {
  assert.deepEqual(DIFFICULTIES, ["beginner", "intermediate", "expert"]);
  assert.deepEqual(CONFIGURATIONS.beginner, { cols: 9, rows: 9, mines: 10 });
  assert.deepEqual(CONFIGURATIONS.intermediate, { cols: 16, rows: 16, mines: 40 });
  assert.deepEqual(CONFIGURATIONS.expert, { cols: 30, rows: 16, mines: 99 });
  assert.ok(Object.isFrozen(CONFIGURATIONS));
  expectRuleError(() => generate({ difficulty: "impossible" }, { seed: 1, firstCell: 0 }), "invalid-input");
});

test("neighborsFor clips to the board edges", () => {
  assert.deepEqual(neighborsFor(0, 9, 9), [1, 9, 10]);
  assert.deepEqual(neighborsFor(40, 9, 9), [30, 31, 32, 39, 41, 48, 49, 50]);
  assert.deepEqual(neighborsFor(80, 9, 9), [70, 71, 79]);
});

test("generate keeps the first click and its neighbours free of mines", () => {
  for (const difficulty of DIFFICULTIES) {
    const { cols, rows, mines } = CONFIGURATIONS[difficulty];
    for (const firstCell of [0, cols - 1, Math.floor((cols * rows) / 2), cols * rows - 1]) {
      const layout = generate({ difficulty }, { seed: 99, firstCell });
      const forbidden = new Set([firstCell, ...neighborsFor(firstCell, cols, rows)]);
      assert.equal(layout.mineCells.length, mines);
      assert.equal(new Set(layout.mineCells).size, mines);
      assert.deepEqual(layout.mineCells, [...layout.mineCells].sort((a, b) => a - b));
      for (const index of layout.mineCells) {
        assert.ok(index >= 0 && index < cols * rows);
        assert.ok(!forbidden.has(index), `${difficulty}: mine at protected cell ${index}`);
      }
    }
  }
});

test("generate is deterministic per seed and varies across seeds", () => {
  const first = generate({ difficulty: "intermediate" }, { seed: 7, firstCell: 100 });
  const again = generate({ difficulty: "intermediate" }, { seed: 7, firstCell: 100 });
  const other = generate({ difficulty: "intermediate" }, { seed: 8, firstCell: 100 });
  assert.deepEqual(first.mineCells, again.mineCells);
  assert.notDeepEqual(first.mineCells, other.mineCells);
  expectRuleError(() => generate({ difficulty: "beginner" }, { seed: -1, firstCell: 0 }), "invalid-input");
  expectRuleError(() => generate({ difficulty: "beginner" }, { seed: 1, firstCell: 81 }), "invalid-input");
});

test("initial computes adjacency counts and rejects tampered layouts", () => {
  const state = board();
  for (const [index, cell] of state.cells.entries()) {
    if (cell.mine) continue;
    const expected = neighborsFor(index, 9, 9).filter((n) => state.cells[n].mine).length;
    assert.equal(cell.adjacent, expected);
  }
  assert.equal(state.cells[40].adjacent, 0);
  assert.equal(state.flagCount, 0);
  assert.equal(state.nextSeq, 1);
  const layout = generate({ difficulty: "beginner" }, { seed: 5, firstCell: 40 });
  expectRuleError(() => initial({ ...layout, mineCells: [40, ...layout.mineCells.slice(1)] }), "invalid-input");
  expectRuleError(() => initial({ ...layout, mineCells: [...layout.mineCells].reverse() }), "invalid-input");
  expectRuleError(() => initial({ ...layout, mineCells: layout.mineCells.slice(1) }), "invalid-input");
});

test("the first reveal cascades from the protected zero cell", () => {
  const state = board("beginner", 40);
  expectRuleError(() => act(state, { op: "reveal", cell: 0 }), "first-cell-mismatch");
  act(state, { op: "reveal", cell: 40 });
  assert.equal(state.started, true);
  assert.ok(state.revealedSafeCount >= 9, "the centre and its eight neighbours open");
  for (const index of [40, ...neighborsFor(40, 9, 9)]) assert.equal(state.cells[index].revealed, true);
  for (const [index, cell] of state.cells.entries()) {
    if (cell.revealed && cell.adjacent === 0) {
      for (const n of neighborsFor(index, 9, 9)) assert.equal(state.cells[n].revealed, true);
    }
  }
  assert.equal(state.moves, 1);
  assert.equal(state.nextSeq, 2);
  expectRuleError(() => act(state, { op: "reveal", cell: 40 }), "illegal-action");
});

test("a corner first click still opens at least its four cells", () => {
  const state = board("beginner", 0);
  act(state, { op: "reveal", cell: 0 });
  assert.ok(state.revealedSafeCount >= 4);
});

test("marks toggle flags and questions and block reveals", () => {
  const state = board();
  act(state, { op: "reveal", cell: 40 });
  const covered = state.cells.findIndex((cell) => !cell.revealed && !cell.mine);
  act(state, { op: "mark", cell: covered, mark: "flag" });
  assert.equal(state.cells[covered].mark, "flag");
  assert.equal(state.flagCount, 1);
  expectRuleError(() => act(state, { op: "reveal", cell: covered }), "illegal-action");
  expectRuleError(() => act(state, { op: "mark", cell: covered, mark: "flag" }), "illegal-action");
  act(state, { op: "mark", cell: covered, mark: "question" });
  assert.equal(state.cells[covered].mark, "question");
  assert.equal(state.flagCount, 0);
  act(state, { op: "mark", cell: covered, mark: "none" });
  assert.equal(state.cells[covered].mark, "none");
  expectRuleError(() => act(state, { op: "mark", cell: covered, mark: "star" }), "illegal-action");
  expectRuleError(() => act(state, { op: "mark", cell: 40, mark: "flag" }), "illegal-action");
  act(state, { op: "mark", cell: covered, mark: "question" });
  act(state, { op: "reveal", cell: covered });
  assert.equal(state.cells[covered].mark, "none", "revealing clears a question mark");
});

test("revealing a mine loses, shows every mine and marks wrong flags", () => {
  const state = board();
  act(state, { op: "reveal", cell: 40 });
  const wrongFlag = state.cells.findIndex((cell) => !cell.revealed && !cell.mine);
  act(state, { op: "mark", cell: wrongFlag, mark: "flag" });
  const mine = mineCells(state)[0];
  act(state, { op: "reveal", cell: mine });
  assert.deepEqual(result(state), { terminal: true, won: false, lost: true, moves: 3, difficulty: "beginner" });
  assert.equal(state.cells[mine].blown, true);
  for (const index of mineCells(state)) assert.equal(state.cells[index].revealed, true);
  assert.equal(state.cells[wrongFlag].misflagged, true);
  expectRuleError(() => act(state, { op: "reveal", cell: 1 }), "terminal");
});

test("revealing every safe cell wins and flags the mines", () => {
  for (const difficulty of DIFFICULTIES) {
    const state = revealAllSafe(board(difficulty, 0, 42));
    const outcome = result(state);
    assert.equal(outcome.won, true, difficulty);
    assert.equal(outcome.lost, false);
    assert.equal(outcome.terminal, true);
    assert.equal(outcome.difficulty, difficulty);
    assert.equal(state.flagCount, CONFIGURATIONS[difficulty].mines);
    for (const index of mineCells(state)) assert.equal(state.cells[index].mark, "flag");
    assert.equal(state.revealedSafeCount, state.cells.length - CONFIGURATIONS[difficulty].mines);
  }
});

test("chording reveals covered neighbours once the flag count matches", () => {
  const state = board("beginner", 40, 3);
  act(state, { op: "reveal", cell: 40 });
  const numbered = state.cells.findIndex(
    (cell, index) =>
      cell.revealed &&
      cell.adjacent > 0 &&
      neighborsFor(index, 9, 9).some((n) => !state.cells[n].revealed && !state.cells[n].mine)
  );
  assert.notEqual(numbered, -1);
  expectRuleError(() => act(state, { op: "chord", cell: numbered }), "illegal-action");
  expectRuleError(() => act(state, { op: "chord", cell: 40 }), "illegal-action");
  for (const n of neighborsFor(numbered, 9, 9)) {
    if (state.cells[n].mine) act(state, { op: "mark", cell: n, mark: "flag" });
  }
  const before = state.revealedSafeCount;
  act(state, { op: "chord", cell: numbered });
  assert.ok(state.revealedSafeCount > before);
  assert.equal(state.lost, false);
  for (const n of neighborsFor(numbered, 9, 9)) {
    if (!state.cells[n].mine) assert.equal(state.cells[n].revealed, true);
  }
  expectRuleError(() => act(state, { op: "chord", cell: numbered }), "illegal-action");
});

test("chording over a misplaced flag loses the game", () => {
  const state = board("beginner", 40, 11);
  act(state, { op: "reveal", cell: 40 });
  const numbered = state.cells.findIndex(
    (cell, index) =>
      cell.revealed &&
      cell.adjacent === 1 &&
      neighborsFor(index, 9, 9).filter((n) => !state.cells[n].revealed && !state.cells[n].mine).length > 0
  );
  assert.notEqual(numbered, -1);
  const safeNeighbor = neighborsFor(numbered, 9, 9).find((n) => !state.cells[n].revealed && !state.cells[n].mine);
  act(state, { op: "mark", cell: safeNeighbor, mark: "flag" });
  act(state, { op: "chord", cell: numbered });
  assert.equal(state.lost, true);
  assert.equal(state.cells[safeNeighbor].misflagged, true);
});

test("transition validates its inputs", () => {
  const state = board();
  expectRuleError(() => act(state, { op: "reveal", cell: 200 }), "invalid-input");
  expectRuleError(() => act(state, { op: "explode", cell: 1 }), "invalid-input");
  expectRuleError(() => transition(state, { seq: 5, op: "reveal", cell: 40 }), "invalid-input");
  expectRuleError(() => act(state, { op: "reveal", cell: 40, extra: true }), "invalid-input");
  expectRuleError(() => transition(null, { seq: 1, op: "reveal", cell: 40 }), "invalid-input");
  expectRuleError(() => result({}), "invalid-input");
  expectRuleError(() => transition(state, { seq: 1, op: "reveal", cell: 40 }, createBudget(0)), "replay-limit");
  const exhausted = board();
  exhausted.nextSeq = LIMITS.inputs + 1;
  expectRuleError(() => transition(exhausted, { seq: exhausted.nextSeq, op: "reveal", cell: 40 }), "replay-limit");
});

test("newBoard wraps generate and initial with a random seed", () => {
  const state = newBoard("expert", 250);
  assert.equal(state.configuration.difficulty, "expert");
  assert.equal(state.firstCell, 250);
  assert.equal(mineCells(state).length, 99);
  assert.equal(state.cells[250].mine, false);
  assert.equal(state.cells[250].adjacent, 0);
  expectRuleError(() => newBoard("beginner", 40, 2 ** 40), "invalid-input");
});

test("seven-segment formatting clamps to three characters", () => {
  assert.equal(COUNTER_MAX, 999);
  assert.equal(formatSevenSegmentCounter(0), "000");
  assert.equal(formatSevenSegmentCounter(7), "007");
  assert.equal(formatSevenSegmentCounter(42), "042");
  assert.equal(formatSevenSegmentCounter(999), "999");
  assert.equal(formatSevenSegmentCounter(1200), "999");
  assert.equal(formatSevenSegmentCounter(-3), "-03");
  assert.equal(formatSevenSegmentCounter(-150), "-99");
  assert.equal(formatSevenSegmentCounter(Number.NaN), "000");
  const sources = digitSources("assets/minesweeper");
  assert.equal(sources["-"], "assets/minesweeper/digital_digits/digital_minus.png");
  assert.equal(sources[" "], "assets/minesweeper/digital_digits/digital_blank.png");
  assert.equal(sources[8], "assets/minesweeper/digital_digits/digital_8.png");
});

test("the manifest lists exactly the package files and every referenced asset exists", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", PACKAGE_DIR), "utf8"));
  assert.equal(manifest.id, "minesweeper");
  assert.equal(manifest.kind, "game");
  assert.ok(manifest.files.includes("apps/minesweeper/index.js"));
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir, base = "") => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relative = `${base}${entry.name}`;
      if (entry.isDirectory()) files.push(...(await walk(new URL(`${entry.name}/`, dir), `${relative}/`)));
      else if (relative !== "manifest.json" && entry.name !== ".DS_Store") files.push(relative);
    }
    return files;
  };
  assert.deepEqual([...manifest.files].sort(), (await walk(PACKAGE_DIR)).sort());
  const css = await readFile(new URL("apps/minesweeper/minesweeper.css", PACKAGE_DIR), "utf8");
  const referenced = [...css.matchAll(/url\("\.\.\/\.\.\/(assets\/minesweeper\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 20);
  for (const file of referenced) assert.ok(manifest.files.includes(file), `${file} missing from manifest`);
  const index = await readFile(new URL("apps/minesweeper/index.js", PACKAGE_DIR), "utf8");
  assert.equal(index.includes("win98SiteKit.minesweeper."), true);
  assert.equal(/gameStats|homeGameSession|notifyActivity|data-admin-target/.test(index), false);
});
