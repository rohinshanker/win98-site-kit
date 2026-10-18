// Pure-rule tests for the Sudoku package: generation, validation, moves,
// completion and the difficulty table. No DOM.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as rules from "../../registry/games/sudoku/apps/sudoku/rules.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../registry/games/sudoku");

const clueCount = (puzzle) => Array.from(puzzle).filter((digit) => digit !== rules.BLANK).length;

/** A deterministic mulberry32 stream so generation tests are repeatable. */
const seededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
};

const freshGame = (difficulty = "easy") =>
  rules.initial({ difficulty, puzzle: rules.STATIC_PUZZLES[difficulty].puzzle, solution: rules.STATIC_PUZZLES[difficulty].solution });

const firstBlank = (state) => state.values.indexOf(rules.BLANK);

test("manifest lists every package file and nothing else", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "sudoku");
  assert.equal(manifest.kind, "game");
  const walk = async (dir, base = dir, files = []) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, base, files);
      else files.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return files.sort();
  };
  const onDisk = (await walk(packageDir)).filter((file) => file !== "manifest.json");
  assert.deepEqual([...manifest.files].sort(), onDisk);
  assert.ok(manifest.files.includes("apps/sudoku/index.js"));
});

test("a generated puzzle has exactly one solution and agrees with it", () => {
  const random = seededRandom(20261018);
  const generated = rules.generatePuzzle(rules.GENERATOR_CLUES.easy, 1, random);
  assert.equal(generated.puzzle.length, rules.CELL_COUNT);
  assert.ok(rules.isCompleteSolution(generated.solution));
  assert.ok(rules.solutionMatchesPuzzle(generated.puzzle, generated.solution));
  assert.equal(generated.clues, clueCount(generated.puzzle));
  assert.ok(generated.clues <= rules.GENERATOR_CLUES.easy, `carved to ${generated.clues} clues`);
  assert.equal(rules.countSolutions(generated.puzzle, 2), 1);
  // The carve is reproducible from the same seed.
  const again = rules.generatePuzzle(rules.GENERATOR_CLUES.easy, 1, seededRandom(20261018));
  assert.equal(again.puzzle, generated.puzzle);
});

test("countSolutions sees a second answer and rejects a contradiction", () => {
  const { solution } = rules.STATIC_PUZZLES.easy;
  assert.equal(rules.countSolutions(solution, 2), 1);
  // A rectangle reading "a b / b a" whose two rows share a band can be
  // swapped without breaking any unit, so blanking it leaves two completions.
  const at = (row, column) => solution[row * 9 + column];
  let rectangle = null;
  for (let band = 0; band < 3 && !rectangle; band += 1) {
    for (let first = band * 3; first < band * 3 + 3 && !rectangle; first += 1) {
      for (let second = first + 1; second < band * 3 + 3 && !rectangle; second += 1) {
        for (let left = 0; left < 9 && !rectangle; left += 1) {
          for (let right = left + 1; right < 9; right += 1) {
            if (at(first, left) === at(second, right) && at(first, right) === at(second, left)) {
              rectangle = [first * 9 + left, first * 9 + right, second * 9 + left, second * 9 + right];
              break;
            }
          }
        }
      }
    }
  }
  assert.ok(rectangle, "the static solution holds a swappable rectangle");
  const cells = Array.from(solution, Number);
  for (const index of rectangle) cells[index] = 0;
  assert.equal(rules.countSolutions(cells, 2), 2);
  assert.equal(rules.countSolutions(cells, 10), 2, "and no more than two");
  const contradiction = Array.from(solution, Number);
  contradiction[1] = contradiction[0];
  assert.equal(rules.countSolutions(contradiction, 2), 0);
  assert.throws(() => rules.countSolutions("123", 2), rules.GameRuleError);
});

test("every static puzzle is solvable to its shipped solution", () => {
  for (const difficulty of rules.DIFFICULTIES) {
    const { puzzle, solution } = rules.STATIC_PUZZLES[difficulty];
    assert.ok(rules.isCompleteSolution(solution), `${difficulty} solution is complete`);
    assert.ok(rules.solutionMatchesPuzzle(puzzle, solution), `${difficulty} puzzle agrees`);
    assert.equal(rules.countSolutions(puzzle, 2), 1, `${difficulty} has one solution`);
  }
});

test("difficulty clue counts descend from easy to extreme", () => {
  const counts = rules.DIFFICULTIES.map((difficulty) => rules.GENERATOR_CLUES[difficulty]);
  assert.deepEqual(counts, [42, 36, 32, 28, 26, 24]);
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index] < counts[index - 1], `${rules.DIFFICULTIES[index]} has fewer clues`);
  }
  assert.throws(() => rules.generatePuzzle(16, 1), rules.GameRuleError);
});

test("candidate validation accepts one digit and refuses everything else", () => {
  assert.equal(rules.assertDigit("7"), "7");
  for (const bad of ["", "0", "89", "a", 7, null]) {
    assert.throws(() => rules.assertDigit(bad), rules.GameRuleError, `rejects ${String(bad)}`);
  }
  const game = freshGame();
  const given = game.puzzle.search(/[1-9]/);
  const blank = firstBlank(game);
  assert.equal(rules.canApply(game, { op: "setValue", index: given, value: "1" }), false);
  assert.equal(rules.canApply(game, { op: "setValue", index: blank, value: "" }), false);
  assert.equal(rules.canApply(game, { op: "setValue", index: blank, value: "12" }), false);
  assert.equal(rules.canApply(game, { op: "setValue", index: 81, value: "1" }), false);
  assert.equal(rules.canApply(game, { op: "setValue", index: blank, value: "5" }), true);
  assert.equal(rules.canApply(game, { op: "bogus" }), false);
  assert.equal(rules.canApply(game, { op: "setValue", index: blank, value: "5", extra: 1 }), false);
  assert.throws(() => rules.transition(game, { op: "clear", index: blank }), rules.GameRuleError);
});

test("placing a digit retires that pencil mark from its peers, and undo restores it", () => {
  const game = freshGame();
  const index = firstBlank(game);
  const peer = rules.PEERS[index].find((candidate) => game.puzzle[candidate] === rules.BLANK);
  const outsider = Array.from({ length: rules.CELL_COUNT }, (unused, cell) => cell).find(
    (cell) => cell !== index && !rules.PEERS[index].includes(cell) && game.puzzle[cell] === rules.BLANK
  );
  rules.transition(game, { op: "toggleNote", index: peer, digit: "3" });
  rules.transition(game, { op: "toggleNote", index: outsider, digit: "3" });
  assert.equal(game.notes[peer], "3");
  rules.transition(game, { op: "setValue", index, value: "3" });
  assert.equal(game.values[index], "3");
  assert.equal(game.notes[peer], "");
  assert.equal(game.notes[outsider], "3");
  rules.transition(game, { op: "undo" });
  assert.equal(game.values[index], rules.BLANK);
  assert.equal(game.notes[peer], "3");
  rules.transition(game, { op: "redo" });
  assert.equal(game.values[index], "3");
  assert.equal(game.notes[peer], "");
  assert.equal(rules.canApply(game, { op: "redo" }), false);
});

test("conflicts read the board; errors need confirmation and set the hint latch", () => {
  const game = freshGame();
  const index = firstBlank(game);
  const rowStart = Math.floor(index / 9) * 9;
  const neighbourValue = game.values.slice(rowStart, rowStart + 9).replace(/0/g, "")[0];
  rules.transition(game, { op: "setValue", index, value: neighbourValue });
  const conflicts = rules.conflictIndexes(game);
  assert.ok(conflicts.includes(index));
  assert.ok(conflicts.length >= 2);
  assert.equal(game.mistakes, 0, "mistakes stay hidden outside Errors mode");
  assert.equal(game.usedHint, false);
  assert.equal(rules.canApply(game, { op: "setHintMode", mode: "errors" }), false);
  rules.transition(game, { op: "confirmErrors" });
  rules.transition(game, { op: "setHintMode", mode: "errors" });
  assert.equal(game.mistakes, 1);
  assert.equal(game.usedHint, true);
  rules.transition(game, { op: "setHintMode", mode: "off" });
  assert.equal(game.mistakes, 0);
  assert.equal(game.usedHint, true, "the latch never clears");
});

test("check reports mistakes and detects a complete, correct board", () => {
  const game = freshGame();
  const index = firstBlank(game);
  const wrong = game.solution[index] === "1" ? "2" : "1";
  rules.transition(game, { op: "setValue", index, value: wrong });
  rules.transition(game, { op: "check" });
  assert.equal(game.mistakes, 1);
  assert.equal(game.solved, false);
  assert.deepEqual(rules.evaluate(game).wrong, [index]);

  for (let cell = 0; cell < rules.CELL_COUNT; cell += 1) {
    if (game.puzzle[cell] !== rules.BLANK || game.values[cell] === game.solution[cell]) continue;
    rules.transition(game, { op: "setValue", index: cell, value: game.solution[cell] });
  }
  const outcome = rules.evaluate(game);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.valid, true);
  assert.equal(game.solved, false, "filling the board is not yet a Check");
  rules.transition(game, { op: "check" });
  assert.equal(game.solved, true);
  assert.equal(game.mistakes, 0);
  // Editing a solved board takes the win back off it.
  rules.transition(game, { op: "clear", index });
  assert.equal(game.solved, false);
});

test("initial validates restored boards", () => {
  const { puzzle, solution } = rules.STATIC_PUZZLES.easy;
  assert.throws(() => rules.initial({ difficulty: "easy", puzzle, solution: puzzle }), rules.GameRuleError);
  assert.throws(() => rules.initial({ difficulty: "easy", puzzle: solution, solution }), rules.GameRuleError);
  assert.throws(() => rules.initial({ difficulty: "silly", puzzle, solution }), rules.GameRuleError);
  assert.throws(() => rules.initial({ difficulty: "easy", puzzle, solution, hintMode: "errors" }), rules.GameRuleError);
  assert.throws(() => rules.initial({ difficulty: "easy", puzzle, solution, solved: true }), rules.GameRuleError);
  const restored = rules.initial({
    difficulty: "easy",
    puzzle,
    solution,
    values: solution,
    notes: [],
    selectedIndex: 4,
    hintMode: "conflicts",
    noteMode: true,
    solved: true,
  });
  assert.equal(restored.solved, true);
  assert.equal(restored.selectedIndex, 4);
  assert.equal(restored.noteMode, true);
  assert.equal(rules.normalizeNotes("9911a3"), "139");
});
