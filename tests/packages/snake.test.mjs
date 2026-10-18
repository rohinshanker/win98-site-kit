// Snake package: the pure rules engine (registry/games/snake/apps/snake/rules.js)
// and the manifest's file list.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLE_SCORE_INTERVAL,
  BOARD_SIZES,
  DIRECTION_QUEUE_MAX,
  GameRuleError,
  LIMITS,
  SNAKE_COUNTDOWN_MS,
  SNAKE_TICK_MS,
  cellsMatch,
  createBudget,
  directionsOppose,
  generate,
  initial,
  nextRandom,
  result,
  step,
  transition,
} from "../../registry/games/snake/apps/snake/rules.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../registry/games/snake");

const newGame = (boardSize = 16, seed = 1234) => initial(generate({ boardSize: String(boardSize) }, { seed }));

const turn = (state, direction) =>
  transition(state, { seq: state.nextSeq, op: "direction", tick: state.tick, direction });

/** Places the only apple at `cell` so a test can steer into it deterministically. */
const placeApple = (state, cell) => {
  state.apples = [{ ...cell }];
  return state;
};

const assertRuleError = (fn, code) => {
  assert.throws(fn, (error) => error instanceof GameRuleError && error.code === code);
};

test("constants match the original game", () => {
  assert.equal(SNAKE_TICK_MS, 118);
  assert.equal(SNAKE_COUNTDOWN_MS, 900);
  assert.deepEqual([...BOARD_SIZES], [10, 16, 20, 24]);
  assert.equal(APPLE_SCORE_INTERVAL, 10);
  assert.equal(DIRECTION_QUEUE_MAX, 2);
  assert.equal(LIMITS.inputs, 16_384);
  assert.equal(LIMITS.ticks, Math.floor((6 * 60 * 60 * 1000) / SNAKE_TICK_MS));
});

test("generate builds a centred three-segment snake heading right with one apple", () => {
  for (const boardSize of BOARD_SIZES) {
    const board = generate({ boardSize: String(boardSize) }, { seed: 7 });
    const centerY = Math.floor(boardSize / 2);
    const startX = Math.max(3, Math.floor(boardSize / 2));
    assert.deepEqual(board.snake, [
      { x: startX, y: centerY },
      { x: startX - 1, y: centerY },
      { x: startX - 2, y: centerY },
    ]);
    assert.equal(board.direction, "right");
    assert.equal(board.apples.length, 1);
    const apple = board.apples[0];
    assert.ok(apple.x >= 0 && apple.x < boardSize && apple.y >= 0 && apple.y < boardSize);
    assert.ok(!board.snake.some((segment) => cellsMatch(segment, apple)));
    assert.equal(board.configuration.boardSize, String(boardSize));
  }
});

test("generate is deterministic for a seed and rejects bad input", () => {
  assert.deepEqual(generate({ boardSize: "16" }, { seed: 99 }), generate({ boardSize: "16" }, { seed: 99 }));
  assert.notDeepEqual(generate({ boardSize: "16" }, { seed: 1 }).apples, generate({ boardSize: "16" }, { seed: 2 }).apples);
  assertRuleError(() => generate({ boardSize: "12" }, { seed: 1 }), "invalid-input");
  assertRuleError(() => generate({ boardSize: 16 }, { seed: 1 }), "invalid-input");
  assertRuleError(() => generate({ boardSize: "16", extra: true }, { seed: 1 }), "invalid-input");
  assertRuleError(() => generate({ boardSize: "16" }, { seed: -1 }), "invalid-input");
  assertRuleError(() => generate({ boardSize: "16" }, { seed: 1.5 }), "invalid-input");
});

test("initial state starts at tick 0 with no score and an empty queue", () => {
  const state = newGame();
  assert.equal(state.tick, 0);
  assert.equal(state.score, 0);
  assert.deepEqual(state.directionQueue, []);
  assert.equal(state.terminal, false);
  assert.equal(state.lost, false);
  assert.equal(state.nextSeq, 1);
  assert.equal(state.directionInputs, 0);
  assert.deepEqual(result(state), {
    terminal: false,
    won: false,
    lost: false,
    score: 0,
    moves: 0,
    configuration: { boardSize: "16" },
    terminalTick: null,
  });
});

test("initial validates the board it is given", () => {
  const board = generate({ boardSize: "10" }, { seed: 3 });
  assertRuleError(() => initial({ ...board, direction: "left" }), "invalid-input");
  assertRuleError(() => initial({ ...board, snake: board.snake.slice(0, 2) }), "invalid-input");
  assertRuleError(() => initial({ ...board, snake: [board.snake[1], board.snake[0], board.snake[2]] }), "invalid-input");
  assertRuleError(() => initial({ ...board, snake: [board.snake[0], board.snake[0], board.snake[2]] }), "invalid-input");
  assertRuleError(() => initial({ ...board, apples: [] }), "invalid-input");
  assertRuleError(() => initial({ ...board, apples: [board.snake[1]] }), "invalid-input");
  assertRuleError(() => initial({ ...board, apples: [{ x: 10, y: 0 }] }), "invalid-input");
  assertRuleError(() => initial({ ...board, rngState: 2 ** 32 }), "invalid-input");
  assertRuleError(() => initial(null), "invalid-input");
  assertRuleError(() => initial([]), "invalid-input");
});

test("step moves the head one cell and drops the tail", () => {
  const state = placeApple(newGame(16), { x: 0, y: 0 });
  step(state);
  assert.deepEqual(state.snake, [
    { x: 9, y: 8 },
    { x: 8, y: 8 },
    { x: 7, y: 8 },
  ]);
  assert.equal(state.tick, 1);
  assert.equal(state.score, 0);
  assert.equal(state.terminal, false);
});

test("eating an apple grows the snake, scores and spawns a replacement", () => {
  const state = placeApple(newGame(16), { x: 9, y: 8 });
  step(state);
  assert.equal(state.snake.length, 4);
  assert.equal(state.score, 1);
  assert.deepEqual(state.snake[0], { x: 9, y: 8 });
  assert.equal(state.apples.length, 1);
  assert.ok(!cellsMatch(state.apples[0], { x: 9, y: 8 }));
  assert.ok(!state.snake.some((segment) => cellsMatch(segment, state.apples[0])));
});

test("one extra apple appears for every ten points", () => {
  const state = newGame(24);
  state.score = APPLE_SCORE_INTERVAL - 1;
  placeApple(state, { x: state.snake[0].x + 1, y: state.snake[0].y });
  step(state);
  assert.equal(state.score, APPLE_SCORE_INTERVAL);
  assert.equal(state.apples.length, 2);
  const keys = new Set(state.apples.map(({ x, y }) => `${x},${y}`));
  assert.equal(keys.size, 2);
});

test("queued turns apply one per tick and reject reversals, repeats and overflow", () => {
  const state = placeApple(newGame(16), { x: 0, y: 0 });
  assertRuleError(() => turn(state, "left"), "illegal-action");
  assertRuleError(() => turn(state, "right"), "illegal-action");
  turn(state, "up");
  assertRuleError(() => turn(state, "down"), "illegal-action");
  turn(state, "left");
  assert.deepEqual(state.directionQueue, ["up", "left"]);
  assertRuleError(() => turn(state, "down"), "illegal-action");
  assert.equal(state.nextSeq, 3);
  assert.equal(state.directionInputs, 2);
  step(state);
  assert.deepEqual(state.snake[0], { x: 8, y: 7 });
  assert.equal(state.direction, "up");
  step(state);
  assert.deepEqual(state.snake[0], { x: 7, y: 7 });
  assert.equal(state.direction, "left");
  assert.deepEqual(state.directionQueue, []);
});

test("transition validates the action envelope", () => {
  const state = newGame(16);
  assertRuleError(() => transition(state, { seq: 2, op: "direction", tick: 0, direction: "up" }), "invalid-input");
  assertRuleError(() => transition(state, { seq: 1, op: "direction", tick: 1, direction: "up" }), "invalid-input");
  assertRuleError(() => transition(state, { seq: 1, op: "turn", tick: 0, direction: "up" }), "invalid-input");
  assertRuleError(() => transition(state, { seq: 1, op: "direction", tick: 0, direction: "diagonal" }), "invalid-input");
  assertRuleError(() => transition(state, { seq: 1, op: "direction", tick: 0 }), "invalid-input");
  assertRuleError(() => transition(null, { seq: 1, op: "direction", tick: 0, direction: "up" }), "invalid-input");
  assert.equal(state.nextSeq, 1);
});

test("hitting a wall ends the game and the result reports the loss", () => {
  const state = placeApple(newGame(10), { x: 0, y: 0 });
  turn(state, "up");
  for (let index = 0; index < 5; index += 1) step(state);
  assert.deepEqual(state.snake[0], { x: 5, y: 0 });
  assert.equal(state.terminal, false);
  step(state);
  assert.equal(state.terminal, true);
  assert.equal(state.lost, true);
  assert.equal(state.tick, 6);
  assert.deepEqual(state.snake[0], { x: 5, y: 0 }, "the body stays where it was when the signal was lost");
  assert.deepEqual(result(state), {
    terminal: true,
    won: false,
    lost: true,
    score: 0,
    moves: 1,
    configuration: { boardSize: "10" },
    terminalTick: 6,
  });
  assertRuleError(() => step(state), "terminal");
  assertRuleError(() => turn(state, "left"), "terminal");
});

test("every wall is solid", () => {
  const drive = (direction, boardSize = 10) => {
    const state = placeApple(newGame(boardSize), { x: 0, y: 0 });
    if (direction !== "right") turn(state, direction === "left" ? "up" : direction);
    if (direction === "left") {
      step(state);
      turn(state, "left");
    }
    let guard = 0;
    while (!state.terminal && guard < 100) {
      step(state);
      guard += 1;
    }
    return state;
  };
  for (const direction of ["up", "down", "left", "right"]) {
    const state = drive(direction);
    assert.equal(state.terminal, true, direction);
    assert.ok(state.snake.every(({ x, y }) => x >= 0 && x < 10 && y >= 0 && y < 10), direction);
  }
});

/** Grows the snake to `length` by feeding it apples straight ahead, then parks the apple away. */
const grownGame = (length) => {
  const state = newGame(16);
  while (state.snake.length < length) {
    placeApple(state, { x: state.snake[0].x + 1, y: state.snake[0].y });
    step(state);
  }
  return placeApple(state, { x: 0, y: 0 });
};

/** Turns a 2x2 loop: down, left, then up, so the head re-enters the row it started on. */
const loopBack = (state) => {
  turn(state, "down");
  turn(state, "left");
  step(state);
  step(state);
  turn(state, "up");
  step(state);
  return state;
};

test("running into the body ends the game", () => {
  const state = grownGame(5);
  assert.deepEqual(state.snake, [
    { x: 10, y: 8 },
    { x: 9, y: 8 },
    { x: 8, y: 8 },
    { x: 7, y: 8 },
    { x: 6, y: 8 },
  ]);
  loopBack(state);
  assert.equal(state.terminal, true, "9,8 is still the fourth segment when the head turns up into it");
  assert.equal(state.lost, true);
  assert.equal(state.snake.length, 5);
});

test("moving into the current tail cell is allowed when not eating", () => {
  const state = grownGame(4);
  assert.deepEqual(state.snake, [
    { x: 9, y: 8 },
    { x: 8, y: 8 },
    { x: 7, y: 8 },
    { x: 6, y: 8 },
  ]);
  loopBack(state);
  assert.equal(state.terminal, false, "the tail vacates 8,8 in the same tick the head enters it");
  assert.deepEqual(state.snake, [
    { x: 8, y: 8 },
    { x: 8, y: 9 },
    { x: 9, y: 9 },
    { x: 9, y: 8 },
  ]);
});

test("eating while entering the tail cell is a collision", () => {
  const state = grownGame(4);
  turn(state, "down");
  turn(state, "left");
  step(state);
  step(state);
  assert.deepEqual(state.snake[state.snake.length - 1], { x: 8, y: 8 });
  placeApple(state, { x: 8, y: 8 });
  turn(state, "up");
  step(state);
  assert.equal(state.terminal, true, "the tail would not move because the snake grows, so the cell stays occupied");
  assert.equal(state.score, 1, "no point for the fatal bite; the one point is from growing to four segments");
  assert.equal(state.snake.length, 4);
});

test("the budget bounds work and the tick limit bounds a game", () => {
  const budget = createBudget(3);
  budget.spend();
  budget.spend(2);
  assertRuleError(() => budget.spend(), "replay-limit");
  assertRuleError(() => createBudget(-1), "invalid-input");
  const state = placeApple(newGame(16), { x: 0, y: 0 });
  assertRuleError(() => step(state, createBudget(0)), "replay-limit");
  const capped = placeApple(newGame(16), { x: 0, y: 0 });
  capped.tick = LIMITS.ticks;
  assertRuleError(() => step(capped), "replay-limit");
  const flooded = newGame(16);
  flooded.nextSeq = LIMITS.inputs + 1;
  assertRuleError(() => turn(flooded, "up"), "replay-limit");
});

test("helpers: directionsOppose, cellsMatch and the Mulberry32 generator", () => {
  assert.equal(directionsOppose("up", "down"), true);
  assert.equal(directionsOppose("left", "right"), true);
  assert.equal(directionsOppose("up", "left"), false);
  assert.equal(directionsOppose("up", "sideways"), false);
  assert.equal(cellsMatch({ x: 1, y: 2 }, { x: 1, y: 2 }), true);
  assert.equal(cellsMatch({ x: 1, y: 2 }, { x: 2, y: 1 }), false);
  const rng = { rngState: 42 };
  const first = nextRandom(rng);
  assert.ok(first >= 0 && first < 1);
  assert.notEqual(rng.rngState, 42);
  assert.equal(nextRandom({ rngState: 42 }), first);
  assertRuleError(() => nextRandom({ rngState: -1 }), "invalid-input");
});

test("result rejects a non-state", () => {
  assertRuleError(() => result({}), "invalid-input");
  assertRuleError(() => result(null), "invalid-input");
});

test("manifest lists every package file and nothing else", async () => {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_DIR, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "snake");
  assert.equal(manifest.kind, "game");
  assert.ok(manifest.files.includes("apps/snake/index.js"));
  const walk = async (dir, base = dir, files = []) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, base, files);
      else if (entry.name !== ".DS_Store") files.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return files.sort();
  };
  const onDisk = (await walk(PACKAGE_DIR)).filter((file) => file !== "manifest.json");
  assert.deepEqual([...manifest.files].sort(), onDisk);
  for (const file of manifest.files) {
    assert.ok(file.startsWith("apps/snake/") || file.startsWith("assets/snake/"), file);
  }
});
