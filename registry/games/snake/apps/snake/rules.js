// Snake rules: the pure game engine (board generation, direction queue,
// stepping, collisions, scoring) plus the small rule helpers it needs. No
// DOM, no kit imports, so node tests can import it directly.

export const SNAKE_TICK_MS = 118;
export const SNAKE_COUNTDOWN_MS = 900;
export const BOARD_SIZES = Object.freeze([10, 16, 20, 24]);
export const APPLE_SCORE_INTERVAL = 10;
export const DIRECTION_QUEUE_MAX = 2;
export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

const SESSION_LIFETIME_MS = 6 * 60 * 60 * 1000;
const MAX_WORK_BUDGET = 120_000_000;

/** Bounds on one game: inputs, primitive work and ticks (six hours of play). */
export const LIMITS = Object.freeze({
  inputs: 16_384,
  work: MAX_WORK_BUDGET,
  ticks: Math.floor(SESSION_LIFETIME_MS / SNAKE_TICK_MS),
});

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

/** The engine charges primitive work against a budget so a game stays bounded. */
export const createBudget = (limit) => ({
  remaining: assertInteger(limit, 0, MAX_WORK_BUDGET, "work budget"),
  spend(units = 1) {
    assertInteger(units, 0, 10_000_000, "work charge");
    if (units > this.remaining) {
      fail("replay-limit", "Game work limit exceeded");
    }
    this.remaining -= units;
  },
});

/** Mulberry32: only the supplied state's RNG word changes. */
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

const ownBudget = (budget) => budget || createBudget(LIMITS.work);

const configurationFor = (config) => {
  assertObject(config, ["boardSize"], "Snake configuration");
  const numeric = Number(config.boardSize);
  if (
    typeof config.boardSize !== "string" ||
    !BOARD_SIZES.includes(numeric) ||
    String(numeric) !== config.boardSize
  ) {
    fail("invalid-input", "Invalid Snake board size");
  }
  return { boardSize: String(numeric) };
};

export const cellsMatch = (left, right) => left.x === right.x && left.y === right.y;

const validateCell = (cell, boardSize, label) => {
  assertObject(cell, ["x", "y"], label);
  assertInteger(cell.x, 0, boardSize - 1, `${label} x`);
  assertInteger(cell.y, 0, boardSize - 1, `${label} y`);
  return { x: cell.x, y: cell.y };
};

export const directionsOppose = (firstDirection, secondDirection) => {
  const first = DIRECTIONS[firstDirection];
  const second = DIRECTIONS[secondDirection];
  return Boolean(first && second && first.x + second.x === 0 && first.y + second.y === 0);
};

const appleTargetCount = (score) => Math.max(1, Math.floor(score / APPLE_SCORE_INTERVAL) + 1);

const refillApples = (state, budget) => {
  const boardSize = Number(state.configuration.boardSize);
  const maximum = boardSize * boardSize - state.snake.length;
  const target = Math.min(appleTargetCount(state.score), maximum);
  if (state.apples.length > target) state.apples.length = target;
  while (state.apples.length < target) {
    const occupied = new Uint8Array(boardSize * boardSize);
    for (const segment of state.snake) {
      budget.spend();
      occupied[segment.y * boardSize + segment.x] = 1;
    }
    for (const apple of state.apples) {
      budget.spend();
      occupied[apple.y * boardSize + apple.x] = 1;
    }
    const open = [];
    for (let y = 0; y < boardSize; y += 1) {
      for (let x = 0; x < boardSize; x += 1) {
        budget.spend();
        if (!occupied[y * boardSize + x]) open.push({ x, y });
      }
    }
    if (!open.length) break;
    state.apples.push(open[randomIndex(state, open.length, budget)]);
  }
};

/** Builds the initial board for `config` from `seed`; feed the result to `initial`. */
export const generate = (config, { seed, budget } = {}) => {
  const configuration = configurationFor(config);
  assertInteger(seed, 0, 0xffffffff, "Snake seed");
  const boardSize = Number(configuration.boardSize);
  const centerY = Math.floor(boardSize / 2);
  const startX = Math.max(3, Math.floor(boardSize / 2));
  const state = {
    configuration,
    rngState: seed,
    snake: [
      { x: startX, y: centerY },
      { x: startX - 1, y: centerY },
      { x: startX - 2, y: centerY },
    ],
    apples: [],
    direction: "right",
    directionQueue: [],
    score: 0,
    tick: 0,
    directionInputs: 0,
    terminal: false,
    lost: false,
    nextSeq: 1,
  };
  refillApples(state, ownBudget(budget));
  return {
    configuration: state.configuration,
    rngState: state.rngState,
    snake: state.snake,
    apples: state.apples,
    direction: state.direction,
  };
};

/** Validates a generated board and returns the full mutable engine state. */
export const initial = (rawInitial) => {
  assertObject(rawInitial, ["configuration", "rngState", "snake", "apples", "direction"], "Snake initial state");
  const configuration = configurationFor(rawInitial.configuration);
  const boardSize = Number(configuration.boardSize);
  assertInteger(rawInitial.rngState, 0, 0xffffffff, "Snake random state");
  if (!Array.isArray(rawInitial.snake) || rawInitial.snake.length !== 3) {
    fail("invalid-input", "Invalid Snake body");
  }
  const snake = rawInitial.snake.map((cell) => validateCell(cell, boardSize, "Snake segment"));
  if (new Set(snake.map(({ x, y }) => `${x},${y}`)).size !== snake.length) {
    fail("invalid-input", "Snake body overlaps itself");
  }
  const centerY = Math.floor(boardSize / 2);
  const startX = Math.max(3, Math.floor(boardSize / 2));
  const expectedSnake = [
    { x: startX, y: centerY },
    { x: startX - 1, y: centerY },
    { x: startX - 2, y: centerY },
  ];
  if (snake.some((cell, index) => !cellsMatch(cell, expectedSnake[index]))) {
    fail("invalid-input", "Snake body does not match the issued configuration");
  }
  if (!Array.isArray(rawInitial.apples) || rawInitial.apples.length !== 1) {
    fail("invalid-input", "Invalid Snake apples");
  }
  const apples = rawInitial.apples.map((cell) => validateCell(cell, boardSize, "Snake apple"));
  if (apples.some((apple) => snake.some((segment) => cellsMatch(segment, apple)))) {
    fail("invalid-input", "Snake apple overlaps the body");
  }
  if (rawInitial.direction !== "right") fail("invalid-input", "Invalid Snake initial direction");
  return {
    configuration,
    rngState: rawInitial.rngState,
    snake,
    apples,
    direction: rawInitial.direction,
    directionQueue: [],
    score: 0,
    tick: 0,
    directionInputs: 0,
    terminal: false,
    lost: false,
    nextSeq: 1,
  };
};

const assertState = (state) => {
  if (!state || typeof state !== "object" || !Array.isArray(state.snake)) {
    fail("invalid-input", "Invalid Snake state");
  }
  if (state.terminal) fail("terminal", "Snake game is already over");
};

/** Queues a direction change; throws `illegal-action` when the turn is not allowed. */
export const transition = (state, input, budget) => {
  assertState(state);
  if (state.nextSeq > LIMITS.inputs) fail("replay-limit", "Snake input limit exceeded");
  ownBudget(budget).spend();
  assertObject(input, ["seq", "op", "tick", "direction"], "Snake action");
  if (
    input.op !== "direction" ||
    input.seq !== state.nextSeq ||
    input.tick !== state.tick ||
    !DIRECTIONS[input.direction]
  ) {
    fail("invalid-input", "Invalid Snake direction action");
  }
  const base = state.directionQueue[state.directionQueue.length - 1] || state.direction;
  if (
    state.directionQueue.length >= DIRECTION_QUEUE_MAX ||
    input.direction === base ||
    directionsOppose(base, input.direction)
  ) {
    fail("illegal-action", "Illegal Snake direction change");
  }
  state.directionQueue.push(input.direction);
  state.directionInputs += 1;
  state.nextSeq += 1;
  return state;
};

/** Advances one tick: moves the head, eats, grows, or ends the game on a wall or body hit. */
export const step = (state, budget) => {
  assertState(state);
  if (state.tick >= LIMITS.ticks) fail("replay-limit", "Snake tick limit exceeded");
  const work = ownBudget(budget);
  if (state.directionQueue.length) state.direction = state.directionQueue.shift();
  const direction = DIRECTIONS[state.direction];
  const head = state.snake[0];
  const nextHead = { x: head.x + direction.x, y: head.y + direction.y };
  const boardSize = Number(state.configuration.boardSize);
  state.tick += 1;
  let eatenAppleIndex = -1;
  for (let index = 0; index < state.apples.length; index += 1) {
    work.spend();
    if (cellsMatch(state.apples[index], nextHead)) {
      eatenAppleIndex = index;
      break;
    }
  }
  const tail = state.snake[state.snake.length - 1];
  const movingIntoTail = eatenAppleIndex === -1 && tail && cellsMatch(nextHead, tail);
  const hitWall = nextHead.x < 0 || nextHead.y < 0 || nextHead.x >= boardSize || nextHead.y >= boardSize;
  let hitSelf = false;
  for (const segment of state.snake) {
    work.spend();
    if (cellsMatch(segment, nextHead)) {
      hitSelf = !movingIntoTail;
      break;
    }
  }
  if (hitWall || hitSelf) {
    state.terminal = true;
    state.lost = true;
    state.directionQueue.length = 0;
    return state;
  }
  if (eatenAppleIndex === -1) state.snake.pop();
  state.snake.unshift(nextHead);
  if (eatenAppleIndex !== -1) {
    state.apples.splice(eatenAppleIndex, 1);
    state.score += 1;
    refillApples(state, work);
  }
  return state;
};

/** A summary of a game: terminal flag, score, moves and the ending tick. */
export const result = (state) => {
  if (!state || typeof state !== "object" || !Array.isArray(state.snake)) {
    fail("invalid-input", "Invalid Snake state");
  }
  return {
    terminal: Boolean(state.terminal),
    won: false,
    lost: Boolean(state.lost),
    score: state.score,
    moves: state.directionInputs,
    configuration: { boardSize: state.configuration.boardSize },
    terminalTick: state.terminal ? state.tick : null,
  };
};
