// Pure-rules tests for the Solitaire package: deal shape, legal and illegal
// moves, undo, foundation completion, the auto-solve plan and the guarantee
// that generated deals are certified by the solver within its budget.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as rules from "../../registry/games/solitaire/apps/solitaire/rules.js";

const EMPTY_FOUNDATIONS = { spades: [], clubs: [], diamonds: [], hearts: [] };

const emptyColumns = () => Array.from({ length: rules.TABLEAU_COLUMNS }, () => ({ down: [], up: [] }));

/** A validated engine state where every card not placed by `layout` sits in the stock. */
const stateFrom = ({ tableau = emptyColumns(), foundations = {}, waste = [] } = {}) => {
  const placed = new Set(waste);
  tableau.forEach((pile) => {
    pile.down.forEach((id) => placed.add(id));
    pile.up.forEach((id) => placed.add(id));
  });
  const heights = Object.fromEntries(rules.SUITS.map((suit) => [suit, foundations[suit] ?? 0]));
  rules.SUITS.forEach((suit) => {
    for (let rank = 1; rank <= heights[suit]; rank += 1) placed.add(`${suit}-${rank}`);
  });
  return rules.initial({
    stock: rules.CARD_IDS.filter((id) => !placed.has(id)),
    waste,
    foundations: heights,
    tableau,
  });
};

const dealToBoard = (deal) => ({
  stock: deal.stock,
  waste: [],
  foundations: EMPTY_FOUNDATIONS,
  tableau: deal.tableau,
  moves: 0,
});

test("a dealt layout has seven columns of 1–7 cards, one face up each, and 24 in the stock", () => {
  const deal = rules.dealShuffledDeck(rules.seededRandom(7));
  assert.equal(deal.tableau.length, rules.TABLEAU_COLUMNS);
  deal.tableau.forEach((column, index) => {
    assert.equal(column.length, index + 1);
    assert.deepEqual(
      column.map((card) => card.faceUp),
      column.map((unused, cardIndex) => cardIndex === column.length - 1)
    );
  });
  assert.equal(deal.stock.length, 24);
  assert.ok(deal.stock.every((card) => !card.faceUp));
  const ids = [...deal.stock, ...deal.tableau.flat()].map((card) => card.id);
  assert.equal(new Set(ids).size, rules.DECK_SIZE);
  assert.deepEqual([...ids].sort(), [...rules.CARD_IDS].sort());

  const state = rules.fromBoard(dealToBoard(deal));
  assert.equal(state.stock.length, 24);
  assert.deepEqual(
    state.tableau.map((pile) => [pile.down.length, pile.up.length]),
    [0, 1, 2, 3, 4, 5, 6].map((down) => [down, 1])
  );
  assert.equal(rules.foundationTotal(state.foundations), 0);
  assert.equal(state.won, false);
});

test("the same seed deals the same layout and different seeds differ", () => {
  const first = rules.dealShuffledDeck(rules.seededRandom(99));
  const again = rules.dealShuffledDeck(rules.seededRandom(99));
  const other = rules.dealShuffledDeck(rules.seededRandom(100));
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, other);
});

test("packed runs alternate colour and descend by one", () => {
  assert.equal(rules.isPackedRun(["hearts-5", "spades-4", "diamonds-3"]), true);
  assert.equal(rules.isPackedRun(["hearts-5", "diamonds-4"]), false);
  assert.equal(rules.isPackedRun(["hearts-5", "spades-3"]), false);
  assert.equal(rules.isPackedRun([]), false);
});

test("tableau moves follow alternating descending order and kings fill empty columns", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["hearts-5"];
  tableau[1].up = ["spades-4"];
  tableau[2].up = ["clubs-13", "diamonds-12"];
  tableau[3].up = ["clubs-7"];
  const state = stateFrom({ tableau });

  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 1, index: 0, to: 0 }), true);
  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 0, index: 0, to: 1 }), false);
  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 2, index: 0, to: 4 }), true);
  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 2, index: 1, to: 4 }), false);
  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 3, index: 0, to: 4 }), false);
  assert.equal(rules.canApply(state, { op: "tableauToTableau", from: 0, index: 0, to: 0 }), false);
  assert.throws(
    () => rules.transition(state, { op: "tableauToTableau", from: 0, index: 0, to: 1 }),
    (error) => error instanceof rules.GameRuleError && error.code === "invalid-move"
  );

  rules.transition(state, { op: "tableauToTableau", from: 1, index: 0, to: 0 });
  assert.deepEqual(state.tableau[0].up, ["hearts-5", "spades-4"]);
  assert.deepEqual(state.tableau[1].up, []);
  assert.equal(state.moves, 1);
});

test("moving a run off a column flips the card it uncovers", () => {
  const tableau = emptyColumns();
  tableau[0].down = ["clubs-9"];
  tableau[0].up = ["diamonds-6"];
  tableau[1].up = ["spades-7"];
  const state = stateFrom({ tableau });
  rules.transition(state, { op: "tableauToTableau", from: 0, index: 0, to: 1 });
  assert.deepEqual(state.tableau[0], { down: [], up: ["clubs-9"] });
  assert.deepEqual(state.tableau[1].up, ["spades-7", "diamonds-6"]);
});

test("foundations accept only the next rank of their suit", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["spades-1"];
  tableau[1].up = ["spades-2"];
  tableau[2].up = ["hearts-2"];
  const state = stateFrom({ tableau });
  assert.equal(rules.canApply(state, { op: "tableauToFoundation", from: 0 }), true);
  assert.equal(rules.canApply(state, { op: "tableauToFoundation", from: 1 }), false);
  assert.equal(rules.canApply(state, { op: "tableauToFoundation", from: 2 }), false);
  rules.transition(state, { op: "tableauToFoundation", from: 0 });
  assert.equal(state.foundations.spades, 1);
  assert.equal(rules.canApply(state, { op: "tableauToFoundation", from: 1 }), true);
  assert.equal(rules.canApply(state, { op: "foundationToTableau", suit: "spades", to: 1 }), false);
  assert.equal(rules.canApply(state, { op: "foundationToTableau", suit: "spades", to: 4 }), false);
  assert.equal(rules.canApply(state, { op: "foundationToTableau", suit: "spades", to: 2 }), true);
});

test("waste cards draw one at a time and the waste redeals in order", () => {
  const state = stateFrom();
  const topOfStock = state.stock[state.stock.length - 1];
  assert.equal(rules.canApply(state, { op: "redeal" }), false);
  assert.equal(rules.canApply(state, { op: "wasteToFoundation" }), false);
  rules.transition(state, { op: "draw" });
  assert.deepEqual(state.waste, [topOfStock]);
  const order = [];
  while (state.stock.length) {
    rules.transition(state, { op: "draw" });
    order.push(state.waste[state.waste.length - 1]);
  }
  assert.equal(rules.canApply(state, { op: "draw" }), false);
  rules.transition(state, { op: "redeal" });
  assert.deepEqual(state.waste, []);
  rules.transition(state, { op: "draw" });
  assert.deepEqual(state.waste, [topOfStock]);
  assert.equal(state.redeals, 1);
});

test("undo restores the previous board and the stack is bounded", () => {
  const state = stateFrom();
  assert.equal(rules.canApply(state, { op: "undo" }), false);
  for (let step = 0; step < rules.MAX_UNDO_STATES + 10; step += 1) {
    rules.transition(state, state.stock.length ? { op: "draw" } : { op: "redeal" });
  }
  assert.equal(state.undo.length, rules.MAX_UNDO_STATES);
  const before = JSON.stringify([state.stock, state.waste]);
  const moves = state.moves;
  rules.transition(state, { op: "draw" });
  rules.transition(state, { op: "undo" });
  assert.equal(JSON.stringify([state.stock, state.waste]), before);
  assert.equal(state.moves, moves);
});

test("placing the last king completes the foundations and wins the deal", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["spades-13"];
  const state = stateFrom({ tableau, foundations: { spades: 12, clubs: 13, diamonds: 13, hearts: 13 } });
  assert.equal(state.stock.length, 0);
  assert.equal(state.won, false);
  rules.transition(state, { op: "tableauToFoundation", from: 0 });
  assert.equal(state.won, true);
  assert.equal(rules.foundationTotal(state.foundations), rules.DECK_SIZE);
  assert.equal(rules.canApply(state, { op: "foundationToTableau", suit: "spades", to: 0 }), false);
  assert.equal(rules.canApply(state, { op: "undo" }), false);
  assert.throws(
    () =>
      rules.initial({
        stock: [],
        waste: [],
        foundations: { spades: 13, clubs: 13, diamonds: 13, hearts: 13 },
        tableau: emptyColumns(),
        won: false,
      }),
    /win flag/
  );
});

test("initial rejects incomplete decks and unpacked face-up runs", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["hearts-5", "diamonds-4"];
  assert.throws(() => stateFrom({ tableau }), /packed/);
  assert.throws(
    () => rules.initial({ stock: rules.CARD_IDS.slice(1), waste: [], foundations: {}, tableau: emptyColumns() }),
    /complete deck/
  );
  assert.throws(() => rules.card("jokers-1"), /Unknown card/);
});

test("the auto-solve plan plays the lowest visible rank first and reports completion", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["spades-2"];
  tableau[1].down = ["hearts-1"];
  tableau[1].up = ["spades-1"];
  const state = stateFrom({ tableau, foundations: { clubs: 13, diamonds: 13, hearts: 0 } });
  // Everything else (hearts 2–13, spades 3–13) is in the stock and never surfaces.
  const board = rules.toBoard(state);
  const first = rules.boardFoundationMove(board);
  assert.deepEqual(first.action, { op: "tableauToFoundation", from: 1 });
  const plan = rules.planAutoSolveBoard(board);
  assert.deepEqual(
    plan.moves.map((move) => [move.suit, move.rank]),
    [["spades", 1], ["hearts", 1], ["spades", 2]]
  );
  assert.equal(plan.completes, false);
  assert.equal(rules.toBoard(state).tableau[1][0].faceUp, false, "planning leaves the live board alone");

  const fullyUp = emptyColumns();
  fullyUp[0].up = ["hearts-13"];
  const finishing = stateFrom({ tableau: fullyUp, foundations: { spades: 13, clubs: 13, diamonds: 13, hearts: 12 } });
  assert.equal(rules.planAutoSolveBoard(rules.toBoard(finishing)).completes, true);
});

test("an auto-solve run takes one undo snapshot and only lands foundation moves", () => {
  const tableau = emptyColumns();
  tableau[0].up = ["spades-1"];
  tableau[1].up = ["spades-2"];
  tableau[2].up = ["clubs-5"];
  const state = stateFrom({ tableau });
  assert.equal(rules.canApply(state, { op: "autoRunEnd" }), false);
  rules.transition(state, { op: "autoRunStart" });
  assert.equal(state.autoRun, true);
  assert.equal(rules.canApply(state, { op: "draw" }), false);
  assert.equal(rules.canApply(state, { op: "autoRunStart" }), false);
  rules.transition(state, { op: "tableauToFoundation", from: 0 });
  rules.transition(state, { op: "tableauToFoundation", from: 1 });
  assert.equal(state.undo.length, 1);
  assert.equal(state.autoMoves, 2);
  rules.transition(state, { op: "autoRunEnd" });
  rules.transition(state, { op: "undo" });
  assert.deepEqual([state.tableau[0].up, state.tableau[1].up], [["spades-1"], ["spades-2"]]);
  assert.equal(state.foundations.spades, 0);
});

test("the auto-solve cadence starts at one second and shrinks to the floor", () => {
  assert.equal(rules.autoSolveIntervalMs(0), 1000);
  assert.equal(rules.autoSolveIntervalMs(1), 860);
  assert.equal(rules.autoSolveIntervalMs(40), rules.AUTO_SOLVE_TIMING.minIntervalMs);
  assert.deepEqual(rules.autoSolvePhaseMs(1000), { liftMs: 550, snapMs: 300 });
});

test("a move budget that runs out throws a replay-limit error", () => {
  const state = stateFrom();
  assert.throws(
    () => rules.transition(state, { op: "draw" }, rules.createBudget(0)),
    (error) => error instanceof rules.GameRuleError && error.code === "replay-limit"
  );
  assert.equal(state.waste.length, 0);
});

/** Draws (and redeals) until `cardId` is the top of the waste. */
const bringToWaste = (state, cardId) => {
  const limit = state.stock.length + state.waste.length + 2;
  for (let step = 0; step < limit; step += 1) {
    if (state.waste[state.waste.length - 1] === cardId) return;
    rules.transition(state, state.stock.length ? { op: "draw" } : { op: "redeal" });
  }
  assert.fail(`${cardId} is not in the stock/waste cycle`);
};

/** Replays a solver solution through the engine; every step must be legal. */
const replaySolution = (deal, solution) => {
  const state = rules.fromBoard(dealToBoard(deal));
  solution.forEach((move, step) => {
    let action;
    if (move.type === "toFoundation" && move.from === "tableau") {
      action = { op: "tableauToFoundation", from: move.column };
    } else if (move.type === "toFoundation") {
      bringToWaste(state, move.cardId);
      action = { op: "wasteToFoundation" };
    } else if (move.from === "tableau") {
      action = {
        op: "tableauToTableau",
        from: move.column,
        index: move.index - state.tableau[move.column].down.length,
        to: move.toColumn,
      };
    } else {
      bringToWaste(state, move.cardId);
      action = { op: "wasteToTableau", to: move.column };
    }
    assert.ok(rules.canApply(state, action), `step ${step} is illegal: ${JSON.stringify(move)}`);
    rules.transition(state, action);
  });
  return state;
};

test("generated deals are certified by the solver within its budget and the line of play wins", () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const deal = rules.buildWinnableDeal(rules.seededRandom(seed));
    assert.equal(deal.verified, true, `seed ${seed} should produce a verified deal`);
    assert.ok(Array.isArray(deal.solution) && deal.solution.length >= rules.DECK_SIZE);
    assert.ok(rules.findWinningMoves(deal, rules.SOLVER_NODE_BUDGET), `seed ${seed} re-solves within the budget`);
    const finished = replaySolution(deal, deal.solution);
    assert.equal(finished.won, true, `seed ${seed} solution should win`);
    assert.equal(rules.foundationTotal(finished.foundations), rules.DECK_SIZE);
  }
});

test("a zero node budget is inconclusive and a shared allowance stops the search", () => {
  const deal = rules.dealShuffledDeck(rules.seededRandom(3));
  assert.equal(rules.findWinningMoves(deal, 0), null);
  const spent = { nodes: 5, limit: 5 };
  assert.equal(rules.searchWinningMoves(deal, rules.SOLVER_NODE_BUDGET, spent), null);
  assert.equal(spent.nodes, 5, "an exhausted allowance visits no node");
});
