// Counter package: the pure model (players, totals, steps, initiative,
// rolling sequences, window columns and persisted-state normalization).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../../registry/apps/counter/apps/counter/model.js";

/** Deterministic PRNG (mulberry32) so roll tests are reproducible. */
const seededRandom = (seed) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

test("createState starts with one player at 20 and initiative hidden", () => {
  const state = model.createState();
  assert.deepEqual(state.players, [
    { id: 1, name: "Player 1", life: 20, selectedStep: 1, initiative: null },
  ]);
  assert.equal(state.nextPlayerId, 2);
  assert.equal(state.initiativeEnabled, false);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.players[0]));
});

test("addPlayer appends numbered players and removePlayer drops by id", () => {
  let state = model.addPlayer(model.addPlayer(model.createState()));
  assert.deepEqual(
    state.players.map((player) => [player.id, player.name]),
    [
      [1, "Player 1"],
      [2, "Player 2"],
      [3, "Player 3"],
    ]
  );
  assert.equal(state.nextPlayerId, 4);
  state = model.removePlayer(state, 2);
  assert.deepEqual(state.players.map((player) => player.id), [1, 3]);
  assert.equal(model.removePlayer(state, 99).players.length, 2);
});

test("removing the last player leaves a fresh Player 1 with a new id", () => {
  const state = model.removePlayer(model.createState(), 1);
  assert.deepEqual(state.players, [
    { id: 2, name: "Player 1", life: 20, selectedStep: 1, initiative: null },
  ]);
  assert.equal(state.nextPlayerId, 3);
});

test("renamePlayer stores the typed name and getPlayer finds it", () => {
  const state = model.renamePlayer(model.createState(), 1, "Alice");
  assert.equal(model.getPlayer(state, 1).name, "Alice");
  assert.equal(model.getPlayer(state, 2), null);
  assert.equal(model.renamePlayer(state, 2, "x"), state);
});

test("normalizeLife truncates, falls back and clamps to the display range", () => {
  assert.equal(model.normalizeLife("12.9"), 12);
  assert.equal(model.normalizeLife("abc"), 20);
  assert.equal(model.normalizeLife(Number.NaN, 7), 7);
  assert.equal(model.normalizeLife(123456), model.MAX_VALUE);
  assert.equal(model.normalizeLife(-123456), model.MIN_VALUE);
});

test("adjustLife uses the selected step and clamps at both ends", () => {
  let state = model.createState();
  state = model.adjustLife(state, 1, 1);
  assert.equal(model.getPlayer(state, 1).life, 21);
  state = model.selectStep(state, 1, 5000);
  state = model.adjustLife(state, 1, 1);
  assert.equal(model.getPlayer(state, 1).life, 5021);
  for (let index = 0; index < 30; index += 1) state = model.adjustLife(state, 1, 1);
  assert.equal(model.getPlayer(state, 1).life, model.MAX_VALUE);
  for (let index = 0; index < 30; index += 1) state = model.adjustLife(state, 1, -1);
  assert.equal(model.getPlayer(state, 1).life, model.MIN_VALUE);
  assert.equal(model.selectStep(state, 1, 7), state, "unknown steps are ignored");
  assert.equal(model.adjustLife(state, 9, 1), state, "unknown players are ignored");
});

test("setLife accepts raw input with a fallback and resetLife restores 20", () => {
  let state = model.addPlayer(model.createState());
  state = model.setLife(state, 1, "-123");
  state = model.setLife(state, 2, "oops", 55);
  assert.deepEqual(state.players.map((player) => player.life), [-123, 55]);
  state = model.resetLife(state);
  assert.deepEqual(state.players.map((player) => player.life), [20, 20]);
});

test("parseSubmitValue accepts non-zero integers only", () => {
  assert.equal(model.parseSubmitValue("15"), 15);
  assert.equal(model.parseSubmitValue("-3.7"), -3);
  assert.equal(model.parseSubmitValue("0"), null);
  assert.equal(model.parseSubmitValue("0.4"), null);
  assert.equal(model.parseSubmitValue(""), null);
  assert.equal(model.parseSubmitValue("   "), null);
  assert.equal(model.parseSubmitValue("abc"), null);
  assert.equal(model.parseSubmitValue(undefined), null);
});

test("formatDigits pads to five cells with a leading minus for negatives", () => {
  assert.equal(model.formatDigits(20), "   20");
  assert.equal(model.formatDigits(0), "    0");
  assert.equal(model.formatDigits(99999), "99999");
  assert.equal(model.formatDigits(-4), "-   4");
  assert.equal(model.formatDigits(-9999), "-9999");
  assert.equal(model.formatDigits(-20000), "-9999");
});

test("initiative values are 1 to 20 and selection ignores anything else", () => {
  assert.equal(model.normalizeInitiative("7"), 7);
  assert.equal(model.normalizeInitiative(20.9), 20);
  assert.equal(model.normalizeInitiative(0), null);
  assert.equal(model.normalizeInitiative(21), null);
  assert.equal(model.normalizeInitiative("x"), null);
  const state = model.createState();
  assert.equal(model.setInitiative(state, 1, 25), state);
  assert.equal(model.getPlayer(model.setInitiative(state, 1, 12), 1).initiative, 12);
  assert.equal(model.setInitiativeEnabled(state, 1).initiativeEnabled, true);
  assert.equal(model.setInitiativeEnabled(state, 0).initiativeEnabled, false);
});

test("initiativeLeaders returns every player tied for the highest roll", () => {
  let state = model.addPlayer(model.addPlayer(model.createState()));
  assert.deepEqual(model.initiativeLeaders(state.players), []);
  state = model.setInitiative(state, 1, 14);
  state = model.setInitiative(state, 3, 14);
  state = model.setInitiative(state, 2, 9);
  assert.deepEqual(model.initiativeLeaders(state.players), [1, 3]);
});

test("initiativeOrder sorts highest first, keeps ties stable and unrolled last", () => {
  let state = model.createState();
  for (let index = 0; index < 4; index += 1) state = model.addPlayer(state);
  state = model.setInitiative(state, 2, 5);
  state = model.setInitiative(state, 3, 18);
  state = model.setInitiative(state, 4, 5);
  state = model.setInitiative(state, 5, 1);
  assert.deepEqual(
    model.initiativeOrder(state.players).map((player) => player.id),
    [3, 2, 4, 5, 1]
  );
});

test("rolls with a seeded random are reproducible and end on the real result", () => {
  const first = model.createRollSequence(seededRandom(42));
  const second = model.createRollSequence(seededRandom(42));
  assert.deepEqual(first, second);
  assert.equal(first.length, model.ROLL_FRAMES);
  assert.ok(first.every((value) => model.INITIATIVE_VALUES.includes(value)));
  assert.equal(first.at(-1), model.rollInitiative(seededRandom(42)));
  assert.notDeepEqual(first, model.createRollSequence(seededRandom(7)));
});

test("rolling two seeded players orders them by their final frames", () => {
  const random = seededRandom(2026);
  let state = model.addPlayer(model.createState());
  const rolls = state.players.map((player) => [player.id, model.createRollSequence(random).at(-1)]);
  for (const [id, value] of rolls) state = model.setInitiative(state, id, value);
  const expected = [...rolls].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
  assert.deepEqual(model.initiativeOrder(state.players).map((player) => player.id), expected);
});

test("rollDelay starts fast and slows to a stop", () => {
  const delays = model.INITIATIVE_VALUES.slice(0, model.ROLL_FRAMES).map((_, index) => model.rollDelay(index));
  assert.equal(delays[0], 36);
  assert.equal(delays.at(-1), 281);
  for (let index = 1; index < delays.length; index += 1) assert.ok(delays[index] >= delays[index - 1]);
});

test("window columns round-trip through widths and respect the minimum", () => {
  assert.equal(model.widthForColumns(1), model.WINDOW_MIN_WIDTH);
  assert.equal(model.widthForColumns(2), 448);
  assert.equal(model.widthForColumns(3), 648);
  assert.equal(model.columnsForWidth(448), 2);
  assert.equal(model.columnsForWidth(648), 3);
  assert.equal(model.columnsForWidth(345), 1);
  assert.equal(model.columnsForWidth(100), 1);
  assert.equal(model.columnsForWidth(Number.NaN), 2);
  assert.equal(model.maxWidthAtPosition(1280), 1232);
  assert.equal(model.maxWidthAtPosition(1280, 1000), 256);
  assert.equal(model.maxWidthAtPosition(375, 300), model.WINDOW_MIN_WIDTH);
});

test("normalizeState rebuilds persisted data and discards junk", () => {
  assert.deepEqual(model.normalizeState(null), model.createState());
  assert.deepEqual(model.normalizeState({ players: "no" }), model.createState());
  const restored = model.normalizeState({
    players: [
      { id: 3, name: "Cat", life: "77", selectedStep: 25, initiative: 4 },
      { id: 3, name: "Duplicate" },
      { id: "x", name: "Bad id" },
      { id: 1, life: 1e9, selectedStep: 2, initiative: 99 },
    ],
    nextPlayerId: 2,
    initiativeEnabled: "yes",
  });
  assert.deepEqual(restored.players, [
    { id: 3, name: "Cat", life: 77, selectedStep: 25, initiative: 4 },
    { id: 1, name: "Player 1", life: model.MAX_VALUE, selectedStep: 1, initiative: null },
  ]);
  assert.equal(restored.nextPlayerId, 4);
  assert.equal(restored.initiativeEnabled, true);
  const empty = model.normalizeState({ players: [], nextPlayerId: 9 });
  assert.deepEqual(empty.players.map((player) => [player.id, player.name]), [[9, "Player 1"]]);
  assert.equal(empty.nextPlayerId, 10);
});
