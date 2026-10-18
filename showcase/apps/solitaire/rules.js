// Klondike Solitaire rules, deal generation and the auto-solve plan. Pure:
// no DOM, no window, importable from node tests. The engine state is JSON
// (card ids, face-down and face-up runs, foundation heights, a move count and
// a bounded undo stack); the UI in index.js draws from a board projection of
// it and asks this module to decide and apply every move.

export const SUITS = Object.freeze(["spades", "clubs", "diamonds", "hearts"]);
const RED_SUITS = Object.freeze(["diamonds", "hearts"]);
export const RANKS = 13;
export const DECK_SIZE = SUITS.length * RANKS;
export const TABLEAU_COLUMNS = 7;
export const MAX_UNDO_STATES = 100;
export const VARIANT = "klondike-draw-one";
const MAX_WORK_BUDGET = 120_000_000;

export const CARD_IDS = Object.freeze(
  SUITS.flatMap((suit) => Array.from({ length: RANKS }, (unused, offset) => `${suit}-${offset + 1}`))
);

/** id -> immutable card facts. Nothing outside this file may add an id. */
const CARDS = new Map(
  CARD_IDS.map((id) => {
    const [suit, rank] = id.split("-");
    return [id, Object.freeze({ id, suit, rank: Number(rank), red: RED_SUITS.includes(suit) })];
  })
);

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

export const assertObject = (value, allowedKeys, label = "object") => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    fail(`Invalid ${label}`, "invalid-input");
  }
  return value;
};

/** Every move charges primitive work against a caller-owned budget. */
export const createBudget = (limit) => ({
  remaining: assertInteger(limit, 0, MAX_WORK_BUDGET, "work budget"),
  spend(units = 1) {
    assertInteger(units, 0, 10_000_000, "work charge");
    if (units > this.remaining) fail("Game work limit exceeded", "replay-limit");
    this.remaining -= units;
  },
});

/** Mulberry32 over `state.rngState`, for reproducible deals in tests. */
export const nextRandom = (state) => {
  assertInteger(state.rngState, 0, 0xffffffff, "random state");
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let value = state.rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
};

/** A seeded `Math.random` stand-in for `buildWinnableDeal`. */
export const seededRandom = (seed) => {
  const state = { rngState: assertInteger(seed, 0, 0xffffffff, "seed") };
  return () => nextRandom(state);
};

export const card = (id) => CARDS.get(id) || fail(`Unknown card: ${String(id)}`, "invalid-input");

const assertCardList = (value, label) => {
  if (!Array.isArray(value) || value.length > DECK_SIZE) fail(`Invalid ${label}`, "invalid-input");
  value.forEach((id) => {
    if (typeof id !== "string") fail(`Invalid ${label}`, "invalid-input");
    card(id);
  });
  return value.slice();
};

export const foundationTotal = (foundations) =>
  SUITS.reduce((total, suit) => total + foundations[suit], 0);

const topOf = (pile) => (pile.length ? pile[pile.length - 1] : null);

const column = (state, index) =>
  state.tableau[assertInteger(index, 0, TABLEAU_COLUMNS - 1, "tableau column")];

/** Descending ranks alternating colour, top of the run first. */
export const isPackedRun = (ids) => {
  if (!Array.isArray(ids) || !ids.length) return false;
  for (let position = 0; position < ids.length - 1; position += 1) {
    const upper = card(ids[position]);
    const lower = card(ids[position + 1]);
    if (upper.red === lower.red || upper.rank !== lower.rank + 1) return false;
  }
  return true;
};

export const acceptsOnTableau = (ids, target) => {
  if (!isPackedRun(ids)) return false;
  const moving = card(ids[0]);
  const targetId = topOf(target.up);
  if (!targetId) return moving.rank === RANKS;
  const resting = card(targetId);
  return moving.red !== resting.red && moving.rank + 1 === resting.rank;
};

export const acceptsOnFoundation = (state, id) => {
  const moving = card(id);
  return state.foundations[moving.suit] + 1 === moving.rank;
};

/** A column always shows its top card: an empty run over a buried one is illegal. */
const flipExposed = (pile) => {
  if (!pile.up.length && pile.down.length) pile.up.push(pile.down.pop());
};

const boardSnapshot = (state) => ({
  stock: state.stock.slice(),
  waste: state.waste.slice(),
  foundations: { ...state.foundations },
  tableau: state.tableau.map((pile) => ({ down: pile.down.slice(), up: pile.up.slice() })),
  moves: state.moves,
  won: state.won,
});

const pushUndo = (state) => {
  // An animated auto-solve run is one step to the player, so the snapshot
  // taken when it opened is the only one: the cards it lands add none.
  if (state.autoRun) return;
  state.undo.push(boardSnapshot(state));
  if (state.undo.length > MAX_UNDO_STATES) state.undo.shift();
};

const restoreSnapshot = (state, snapshot) => {
  state.stock = snapshot.stock.slice();
  state.waste = snapshot.waste.slice();
  state.foundations = { ...snapshot.foundations };
  state.tableau = snapshot.tableau.map((pile) => ({ down: pile.down.slice(), up: pile.up.slice() }));
  state.moves = snapshot.moves;
  state.won = snapshot.won;
};

/** Every card accounted for exactly once. */
const assertCompleteDeck = (state) => {
  const seen = new Set();
  const claim = (id) => {
    if (seen.has(id)) fail("A card appears twice on the board", "invalid-input");
    seen.add(id);
  };
  state.stock.forEach(claim);
  state.waste.forEach(claim);
  state.tableau.forEach((pile) => {
    pile.down.forEach(claim);
    pile.up.forEach(claim);
  });
  SUITS.forEach((suit) => {
    for (let rank = 1; rank <= state.foundations[suit]; rank += 1) claim(`${suit}-${rank}`);
  });
  if (seen.size !== DECK_SIZE) fail("The board is not a complete deck", "invalid-input");
};

const normalizeFoundations = (raw) => {
  const value = assertObject(raw ?? {}, SUITS, "foundations");
  return Object.fromEntries(
    SUITS.map((suit) => [suit, assertInteger(value[suit] ?? 0, 0, RANKS, `${suit} foundation`)])
  );
};

const normalizeTableau = (raw) => {
  if (!Array.isArray(raw) || raw.length !== TABLEAU_COLUMNS) {
    fail("Solitaire needs seven tableau columns", "invalid-input");
  }
  return raw.map((pile) => {
    const value = assertObject(pile, ["down", "up"], "tableau column");
    const down = assertCardList(value.down ?? [], "tableau column");
    const up = assertCardList(value.up ?? [], "tableau column");
    if (down.length && !up.length) fail("A tableau column must show its top card", "invalid-input");
    if (up.length && !isPackedRun(up)) fail("A face-up tableau run must be packed", "invalid-input");
    return { down, up };
  });
};

/** Validates a raw board and returns the working state with an empty undo stack. */
export const initial = (rawInitial) => {
  const raw = assertObject(
    rawInitial,
    ["stock", "waste", "foundations", "tableau", "moves", "won", "redeals", "variant"],
    "Solitaire initial state"
  );
  if (raw.variant !== undefined && raw.variant !== VARIANT) {
    fail("Unsupported Solitaire variant", "invalid-input");
  }
  const state = {
    stock: assertCardList(raw.stock ?? [], "stock"),
    waste: assertCardList(raw.waste ?? [], "waste"),
    foundations: normalizeFoundations(raw.foundations),
    tableau: normalizeTableau(raw.tableau),
    moves: assertInteger(raw.moves ?? 0, 0, 100_000, "move count"),
    redeals: assertInteger(raw.redeals ?? 0, 0, 100_000, "redeal count"),
    autoMoves: 0,
    autoRun: false,
    undo: [],
    won: false,
  };
  assertCompleteDeck(state);
  const complete = foundationTotal(state.foundations) === DECK_SIZE;
  if (raw.won !== undefined && Boolean(raw.won) !== complete) {
    fail("The win flag does not match the foundations", "invalid-input");
  }
  state.won = complete;
  return state;
};

const settle = (state) => {
  state.won = foundationTotal(state.foundations) === DECK_SIZE;
  // A finished deal is not solving itself, so the run ends with the win.
  if (state.won) state.autoRun = false;
  return state;
};

const countMove = (state, { auto = false } = {}) => {
  state.moves += 1;
  if (auto) state.autoMoves += 1;
};

const OPERATIONS = Object.freeze({
  draw: {
    keys: [],
    cost: () => 1,
    check(state) {
      if (!state.stock.length) fail("The stock is empty");
    },
    apply(state) {
      pushUndo(state);
      state.waste.push(state.stock.pop());
      countMove(state);
    },
  },
  redeal: {
    keys: [],
    cost: (state) => 1 + state.waste.length,
    check(state) {
      if (state.stock.length) fail("The stock still holds cards");
      if (!state.waste.length) fail("There is nothing to redeal");
    },
    apply(state) {
      pushUndo(state);
      state.stock = state.waste.reverse();
      state.waste = [];
      state.redeals += 1;
      countMove(state);
    },
  },
  tableauToTableau: {
    keys: ["from", "index", "to"],
    cost: () => TABLEAU_COLUMNS,
    check(state, action) {
      const source = column(state, action.from);
      const to = assertInteger(action.to, 0, TABLEAU_COLUMNS - 1, "target column");
      if (action.from === to) fail("A run cannot move onto its own column");
      if (!source.up.length) fail("That column has no face-up cards");
      assertInteger(action.index, 0, source.up.length - 1, "run start");
      if (!acceptsOnTableau(source.up.slice(action.index), state.tableau[to])) {
        fail("That run does not fit there");
      }
    },
    apply(state, action) {
      pushUndo(state);
      const source = state.tableau[action.from];
      const moving = source.up.splice(action.index);
      state.tableau[action.to].up.push(...moving);
      flipExposed(source);
      countMove(state);
    },
  },
  wasteToTableau: {
    keys: ["to"],
    cost: () => 2,
    check(state, action) {
      const to = assertInteger(action.to, 0, TABLEAU_COLUMNS - 1, "target column");
      const id = topOf(state.waste) ?? fail("The waste is empty");
      if (!acceptsOnTableau([id], state.tableau[to])) fail("That card does not fit there");
    },
    apply(state, action) {
      pushUndo(state);
      state.tableau[action.to].up.push(state.waste.pop());
      countMove(state);
    },
  },
  tableauToFoundation: {
    keys: ["from"],
    cost: () => 2,
    check(state, action) {
      const source = column(state, action.from);
      const id = topOf(source.up) ?? fail("That column has no face-up cards");
      if (!acceptsOnFoundation(state, id)) fail("That card does not fit its foundation");
    },
    apply(state, action) {
      pushUndo(state);
      const source = state.tableau[action.from];
      state.foundations[card(source.up.pop()).suit] += 1;
      flipExposed(source);
      countMove(state, { auto: state.autoRun });
    },
  },
  wasteToFoundation: {
    keys: [],
    cost: () => 2,
    check(state) {
      const id = topOf(state.waste) ?? fail("The waste is empty");
      if (!acceptsOnFoundation(state, id)) fail("That card does not fit its foundation");
    },
    apply(state) {
      pushUndo(state);
      state.foundations[card(state.waste.pop()).suit] += 1;
      countMove(state, { auto: state.autoRun });
    },
  },
  foundationToTableau: {
    keys: ["suit", "to"],
    cost: () => 2,
    check(state, action) {
      if (!SUITS.includes(action.suit)) fail("Unknown foundation suit", "invalid-input");
      const rank = state.foundations[action.suit];
      if (!rank) fail("That foundation is empty");
      const to = assertInteger(action.to, 0, TABLEAU_COLUMNS - 1, "target column");
      if (!acceptsOnTableau([`${action.suit}-${rank}`], state.tableau[to])) {
        fail("That card does not fit there");
      }
    },
    apply(state, action) {
      pushUndo(state);
      const rank = state.foundations[action.suit];
      state.foundations[action.suit] -= 1;
      state.tableau[action.to].up.push(`${action.suit}-${rank}`);
      countMove(state);
    },
  },
  undo: {
    keys: [],
    cost: () => DECK_SIZE,
    check(state) {
      if (!state.undo.length) fail("There is nothing to undo");
    },
    apply(state) {
      restoreSnapshot(state, state.undo.pop());
    },
  },
  autoRunStart: {
    keys: [],
    cost: () => DECK_SIZE,
    check(state) {
      if (!nextFoundationMove(state)) fail("No visible card can move to a foundation");
    },
    apply(state) {
      pushUndo(state);
      state.autoRun = true;
    },
  },
  autoRunEnd: {
    keys: [],
    cost: () => 1,
    check(state) {
      if (!state.autoRun) fail("The board is not solving itself");
    },
    apply(state) {
      state.autoRun = false;
    },
  },
});

/** Only foundation moves land during an auto-solve run; one snapshot covers it. */
const AUTO_RUN_OPERATIONS = Object.freeze(["tableauToFoundation", "wasteToFoundation", "autoRunEnd"]);

/** Throws the exact reason `action` cannot be played, or returns its operation. */
const review = (state, action) => {
  if (state.won) fail("The board is already won");
  const operation =
    OPERATIONS[action?.op] || fail(`Unknown Solitaire move: ${String(action?.op)}`, "invalid-input");
  assertObject(action, ["op", ...operation.keys], "Solitaire move");
  if (state.autoRun && action.op === "autoRunStart") fail("The board is already solving itself");
  if (state.autoRun && !AUTO_RUN_OPERATIONS.includes(action.op)) {
    fail("Only an auto-solve foundation move can land during a run");
  }
  operation.check(state, action);
  return operation;
};

/** Applies `action` to `state` in place, charging `budget`; throws when illegal. */
export const transition = (state, action, budget = createBudget(MAX_WORK_BUDGET)) => {
  const operation = review(state, action);
  budget.spend(operation.cost(state, action));
  operation.apply(state, action);
  return settle(state);
};

/** Whether `action` is playable now. */
export const canApply = (state, action) => {
  try {
    review(state, action);
    return true;
  } catch (error) {
    if (error instanceof GameRuleError) return false;
    throw error;
  }
};

/**
 * The lowest-ranked foundation move available from a visible card: a tableau
 * top or the top of the waste. It reads a board of cards (what the UI draws),
 * and each move carries the engine action that lands it.
 */
export const boardFoundationMove = (board) => {
  const height = (suit) => (board.foundations?.[suit] || []).length;
  const wanted = (entry, suit) =>
    Boolean(entry) && entry.faceUp === true && entry.suit === suit && entry.rank === height(suit) + 1;
  let best = null;
  const consider = (move) => {
    if (move.rank <= RANKS && (!best || move.rank < best.rank)) best = move;
  };
  SUITS.forEach((suit) => {
    const rank = height(suit) + 1;
    if (rank > RANKS) return;
    const columns = board.tableau || [];
    for (let pile = 0; pile < columns.length; pile += 1) {
      const cards = columns[pile] || [];
      if (wanted(cards[cards.length - 1], suit)) {
        consider({
          zone: "tableau",
          pile,
          index: cards.length - 1,
          suit,
          rank,
          action: { op: "tableauToFoundation", from: pile },
        });
        return;
      }
    }
    const waste = board.waste || [];
    if (wanted(waste[waste.length - 1], suit)) {
      consider({
        zone: "waste",
        pile: "waste",
        index: waste.length - 1,
        suit,
        rank,
        action: { op: "wasteToFoundation" },
      });
    }
  });
  return best;
};

/**
 * Every foundation move an auto-solve run would make, lowest rank first,
 * until no visible card fits, and whether that chain finishes the deal.
 * Planning works on a copy, so the live board is untouched.
 */
export const planAutoSolveBoard = (board) => {
  const copy = (cards) => (cards || []).map((entry) => ({ ...entry }));
  const trial = {
    waste: copy(board.waste),
    foundations: Object.fromEntries(SUITS.map((suit) => [suit, copy(board.foundations?.[suit])])),
    tableau: (board.tableau || []).map(copy),
  };
  const moves = [];
  for (let move = boardFoundationMove(trial); move; move = boardFoundationMove(trial)) {
    moves.push(move);
    const source = move.zone === "tableau" ? trial.tableau[move.pile] : trial.waste;
    const [moved] = source.splice(move.index, 1);
    trial.foundations[move.suit].push(moved);
    const exposed = move.zone === "tableau" ? source[source.length - 1] : null;
    if (exposed && !exposed.faceUp) exposed.faceUp = true;
    if (moves.length > DECK_SIZE) fail("Auto-solve plan overran the deck");
  }
  const placed = SUITS.reduce((total, suit) => total + trial.foundations[suit].length, 0);
  return { moves, completes: placed === DECK_SIZE };
};

export const nextFoundationMove = (state) => boardFoundationMove(toBoard(state));

/**
 * The board as cards to draw: stock face down, waste face up, and each
 * tableau column's buried run face down beneath its face-up run.
 */
export const toBoard = (state) => {
  const face = (id, faceUp) => ({ ...card(id), faceUp });
  return {
    stock: state.stock.map((id) => face(id, false)),
    waste: state.waste.map((id) => face(id, true)),
    foundations: Object.fromEntries(
      SUITS.map((suit) => [
        suit,
        Array.from({ length: state.foundations[suit] }, (unused, offset) => face(`${suit}-${offset + 1}`, true)),
      ])
    ),
    tableau: state.tableau.map((pile) => [
      ...pile.down.map((id) => face(id, false)),
      ...pile.up.map((id) => face(id, true)),
    ]),
    moves: state.moves,
    won: state.won,
  };
};

/** The inverse of `toBoard`: validates a board of cards into engine state. */
export const fromBoard = (board) => {
  if (!board || typeof board !== "object") fail("Invalid Solitaire board", "invalid-input");
  const ids = (cards) =>
    (Array.isArray(cards) ? cards : fail("Invalid pile", "invalid-input")).map((entry) => card(entry?.id).id);
  const foundations = board.foundations ?? {};
  const tableau = Array.isArray(board.tableau) ? board.tableau : fail("Invalid tableau", "invalid-input");
  return initial({
    stock: ids(board.stock ?? []),
    waste: ids(board.waste ?? []),
    foundations: Object.fromEntries(SUITS.map((suit) => [suit, ids(foundations[suit] ?? []).length])),
    tableau: tableau.map((cards) => {
      const pile = ids(cards);
      const firstUp = cards.findIndex((entry) => entry.faceUp);
      const split = firstUp < 0 ? pile.length : firstUp;
      return { down: pile.slice(0, split), up: pile.slice(split) };
    }),
    moves: board.moves ?? 0,
  });
};

// ------------------------------------------------------------ deal generation

export const SOLVER_NODE_BUDGET = 12_000;
export const GENERATION_NODE_BUDGET = 40_000;
export const DEAL_ATTEMPT_CAP = 12;

export const buildDeck = () =>
  SUITS.flatMap((suit) =>
    Array.from({ length: RANKS }, (unused, offset) => ({
      id: `${suit}-${offset + 1}`,
      suit,
      rank: offset + 1,
      faceUp: false,
    }))
  );

const shuffleCards = (cards, random) => {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
};

/** A uniform random Klondike deal: 1–7 card columns, only each top face up. */
export const dealShuffledDeck = (random = Math.random) => {
  const deck = shuffleCards(buildDeck(), random);
  const tableau = [];
  let deckIndex = 0;
  for (let length = 1; length <= TABLEAU_COLUMNS; length += 1) {
    const cards = deck.slice(deckIndex, deckIndex + length);
    cards.at(-1).faceUp = true;
    tableau.push(cards);
    deckIndex += length;
  }
  return { stock: deck.slice(deckIndex), tableau };
};

/**
 * Perfect-information depth-first search for a winning line under draw-one,
 * unlimited-redeal rules. The stock/waste cycle is treated as an unordered
 * set because every card in it is reachable. Returns the move list, or null
 * when the search is inconclusive within `nodeBudget` (and the shared
 * `generationWork` allowance).
 */
export const searchWinningMoves = (deal, nodeBudget, generationWork = { nodes: 0, limit: nodeBudget }) => {
  const cards = [...deal.stock, ...deal.tableau.flat()];
  const cardIds = new Set(cards.map((entry) => entry.id));
  const suitIndex = Object.fromEntries(SUITS.map((suit, index) => [suit, index]));
  const cardCode = new Map(cards.map((entry, index) => [entry.id, index]));
  const codeCard = cards.map((entry) => ({
    id: entry.id,
    rank: entry.rank,
    suit: entry.suit,
    suitIndex: suitIndex[entry.suit],
    color: RED_SUITS.includes(entry.suit) ? 1 : 0,
  }));
  const state = {
    foundations: [0, 0, 0, 0],
    stock: deal.stock.map((entry) => cardCode.get(entry.id)),
    tableau: deal.tableau.map((cardsInColumn) => {
      const firstFaceUp = cardsInColumn.findIndex((entry) => entry.faceUp);
      return {
        down: cardsInColumn.slice(0, firstFaceUp).map((entry) => cardCode.get(entry.id)),
        up: cardsInColumn.slice(firstFaceUp).map((entry) => cardCode.get(entry.id)),
      };
    }),
    path: null,
  };
  const visited = new Set();
  let nodes = 0;

  const cloneState = (current) => ({
    foundations: [...current.foundations],
    stock: [...current.stock],
    tableau: current.tableau.map((pile) => ({ down: [...pile.down], up: [...pile.up] })),
    path: current.path,
  });

  const recordMove = (current, move) => {
    current.path = { move, previous: current.path };
  };

  const flipTableauTop = (pile) => {
    if (!pile.up.length && pile.down.length) pile.up.push(pile.down.pop());
  };

  const canMoveToFoundation = (current, code) => {
    const entry = codeCard[code];
    return current.foundations[entry.suitIndex] + 1 === entry.rank;
  };

  const isSafeFoundationMove = (current, code) => {
    const entry = codeCard[code];
    if (entry.rank <= 2) return true;
    const oppositeSuitIndexes = entry.color ? [0, 1] : [2, 3];
    return oppositeSuitIndexes.every((index) => current.foundations[index] >= entry.rank - 1);
  };

  const moveTableauTopToFoundation = (current, columnIndex) => {
    const pile = current.tableau[columnIndex];
    const code = pile.up.pop();
    const entry = codeCard[code];
    current.foundations[entry.suitIndex] = entry.rank;
    recordMove(current, { type: "toFoundation", from: "tableau", column: columnIndex });
    flipTableauTop(pile);
  };

  const moveStockToFoundation = (current, stockIndex) => {
    const [code] = current.stock.splice(stockIndex, 1);
    const entry = codeCard[code];
    current.foundations[entry.suitIndex] = entry.rank;
    recordMove(current, { type: "toFoundation", from: "stock", cardId: entry.id });
  };

  const applySafeFoundationMoves = (current) => {
    let moved = true;
    while (moved) {
      moved = false;
      for (let columnIndex = 0; columnIndex < TABLEAU_COLUMNS; columnIndex += 1) {
        const code = current.tableau[columnIndex].up.at(-1);
        if (code !== undefined && canMoveToFoundation(current, code) && isSafeFoundationMove(current, code)) {
          moveTableauTopToFoundation(current, columnIndex);
          moved = true;
          break;
        }
      }
      if (moved) continue;
      const stockIndex = current.stock.findIndex(
        (code) => canMoveToFoundation(current, code) && isSafeFoundationMove(current, code)
      );
      if (stockIndex >= 0) {
        moveStockToFoundation(current, stockIndex);
        moved = true;
      }
    }
  };

  const encodeCodes = (codes) => String.fromCharCode(...codes.map((code) => 65 + code));

  const stateKey = (current) => {
    const stockKey = encodeCodes([...current.stock].sort((left, right) => left - right));
    const columnKeys = current.tableau
      .map((pile) => `${encodeCodes(pile.down)}/${encodeCodes(pile.up)}`)
      .sort();
    return `${encodeCodes(current.foundations)}|${stockKey}|${columnKeys.join("|")}`;
  };

  const canMoveRunToColumn = (current, code, targetIndex) => {
    const target = current.tableau[targetIndex].up.at(-1);
    const entry = codeCard[code];
    if (target === undefined) return entry.rank === RANKS;
    const targetCard = codeCard[target];
    return entry.color !== targetCard.color && entry.rank + 1 === targetCard.rank;
  };

  const exposedTargetIsNeeded = (current, sourceIndex, startIndex) => {
    const exposed = codeCard[current.tableau[sourceIndex].up[startIndex - 1]];
    if (current.foundations[exposed.suitIndex] + 1 === exposed.rank) return true;
    const fitsExposed = (code) => {
      const entry = codeCard[code];
      return entry.color !== exposed.color && entry.rank + 1 === exposed.rank;
    };
    if (current.stock.some(fitsExposed)) return true;
    return current.tableau.some((pile, columnIndex) => {
      if (columnIndex === sourceIndex) return false;
      return pile.up.some((code) => fitsExposed(code));
    });
  };

  const tableauMoves = (current) => {
    const moves = [];
    current.tableau.forEach((pile, sourceIndex) => {
      pile.up.forEach((code, startIndex) => {
        const isWholeRun = startIndex === 0;
        if (!isWholeRun && !exposedTargetIsNeeded(current, sourceIndex, startIndex)) return;
        current.tableau.forEach((target, targetIndex) => {
          if (targetIndex === sourceIndex) return;
          if (!canMoveRunToColumn(current, code, targetIndex)) return;
          if (
            !target.up.length &&
            !target.down.length &&
            isWholeRun &&
            !pile.down.length &&
            codeCard[code].rank === RANKS
          ) {
            return;
          }
          moves.push({
            sourceIndex,
            startIndex,
            targetIndex,
            flipsCard: isWholeRun && pile.down.length > 0,
          });
        });
      });
    });
    moves.sort((left, right) => Number(right.flipsCard) - Number(left.flipsCard));
    return moves;
  };

  const stockTableauMoves = (current) => {
    const moves = [];
    current.stock.forEach((code, stockIndex) => {
      current.tableau.forEach((pile, targetIndex) => {
        if (canMoveRunToColumn(current, code, targetIndex)) moves.push({ code, stockIndex, targetIndex });
      });
    });
    return moves;
  };

  const exhausted = () => nodes >= nodeBudget || generationWork.nodes >= generationWork.limit;

  const search = (current) => {
    if (exhausted()) return null;
    applySafeFoundationMoves(current);
    if (current.foundations.every((rank) => rank === RANKS)) {
      const moves = [];
      for (let step = current.path; step; step = step.previous) moves.push(step.move);
      return moves.reverse();
    }

    const key = stateKey(current);
    if (visited.has(key)) return null;
    visited.add(key);
    nodes += 1;
    generationWork.nodes += 1;

    for (let columnIndex = 0; columnIndex < TABLEAU_COLUMNS; columnIndex += 1) {
      const code = current.tableau[columnIndex].up.at(-1);
      if (code !== undefined && canMoveToFoundation(current, code)) {
        const next = cloneState(current);
        moveTableauTopToFoundation(next, columnIndex);
        const solution = search(next);
        if (solution) return solution;
      }
    }

    for (let stockIndex = 0; stockIndex < current.stock.length; stockIndex += 1) {
      if (canMoveToFoundation(current, current.stock[stockIndex])) {
        const next = cloneState(current);
        moveStockToFoundation(next, stockIndex);
        const solution = search(next);
        if (solution) return solution;
      }
    }

    const availableTableauMoves = tableauMoves(current);
    const tryTableauMoves = (flipsCard) => {
      for (const move of availableTableauMoves) {
        if (move.flipsCard !== flipsCard) continue;
        const next = cloneState(current);
        const source = next.tableau[move.sourceIndex];
        const moving = source.up.splice(move.startIndex);
        next.tableau[move.targetIndex].up.push(...moving);
        recordMove(next, {
          type: "toTableau",
          from: "tableau",
          column: move.sourceIndex,
          index: source.down.length + move.startIndex,
          toColumn: move.targetIndex,
        });
        flipTableauTop(source);
        const solution = search(next);
        if (solution) return solution;
        if (exhausted()) return null;
      }
      return null;
    };

    const flipSolution = tryTableauMoves(true);
    if (flipSolution) return flipSolution;

    for (const move of stockTableauMoves(current)) {
      const next = cloneState(current);
      next.stock.splice(move.stockIndex, 1);
      next.tableau[move.targetIndex].up.push(move.code);
      recordMove(next, {
        type: "toTableau",
        from: "stock",
        cardId: codeCard[move.code].id,
        column: move.targetIndex,
      });
      const solution = search(next);
      if (solution) return solution;
      if (exhausted()) break;
    }

    return tryTableauMoves(false);
  };

  if (cardIds.size !== DECK_SIZE) return null;
  return search(state);
};

export const findWinningMoves = (deal, nodeBudget = SOLVER_NODE_BUDGET) => searchWinningMoves(deal, nodeBudget);

/**
 * Rejection-samples uniform random deals until the solver certifies one, up
 * to `DEAL_ATTEMPT_CAP` shuffles sharing `GENERATION_NODE_BUDGET` nodes. When
 * every bounded search is inconclusive the last deal is returned unverified.
 */
export const buildWinnableDeal = (random = Math.random) => {
  let deal = null;
  const generationWork = { nodes: 0, limit: GENERATION_NODE_BUDGET };
  for (let attempt = 0; attempt < DEAL_ATTEMPT_CAP && generationWork.nodes < generationWork.limit; attempt += 1) {
    deal = dealShuffledDeck(random);
    const solution = searchWinningMoves(deal, SOLVER_NODE_BUDGET, generationWork);
    if (solution) return { ...deal, solution, verified: true };
  }
  return { ...deal, solution: null, verified: false };
};

// ------------------------------------------------------------- auto-solve pace

export const AUTO_SOLVE_TIMING = Object.freeze({
  firstIntervalMs: 1000,
  accelerationFactor: 0.86,
  minIntervalMs: 120,
  liftShare: 0.55,
  snapShare: 0.3,
});

/** The gap before card `step` leaves: 1000ms shrinking by ×0.86 to a 120ms floor. */
export const autoSolveIntervalMs = (step, timing = AUTO_SOLVE_TIMING) =>
  Math.max(timing.minIntervalMs, Math.round(timing.firstIntervalMs * timing.accelerationFactor ** step));

/** How long a card floats up and then snaps down inside its interval. */
export const autoSolvePhaseMs = (intervalMs, timing = AUTO_SOLVE_TIMING) => ({
  liftMs: Math.round(intervalMs * timing.liftShare),
  snapMs: Math.round(intervalMs * timing.snapShare),
});
