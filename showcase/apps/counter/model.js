// Counter model: pure state logic for the life counter (players, totals,
// step selection, initiative values and ordering, window column widths).
// No DOM, no timers; apps/counter/index.js owns rendering and persistence.

export const STARTING_LIFE = 20;
export const MIN_VALUE = -9999;
export const MAX_VALUE = 99999;
export const STEP_VALUES = Object.freeze([1, 5, 10, 25, 50, 100, 500, 1000, 5000]);
export const INITIATIVE_VALUES = Object.freeze(Array.from({ length: 20 }, (_, index) => index + 1));
export const ROLL_FRAMES = 18;

export const WINDOW_MIN_WIDTH = 254;
export const WINDOW_DEFAULT_WIDTH = 448;
export const WINDOW_COLUMN_WIDTH = 192;
export const WINDOW_COLUMN_GAP = 8;
export const WINDOW_EXTRA_WIDTH = 56;
export const WINDOW_VIEWPORT_PADDING = 24;

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/** Clamps any input to an integer life total, falling back when not numeric. */
export const normalizeLife = (value, fallback = STARTING_LIFE) => {
  const parsed = Number(value);
  const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return clamp(next, MIN_VALUE, MAX_VALUE);
};

/** An initiative value is an integer from 1 to 20; anything else is null. */
export const normalizeInitiative = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return INITIATIVE_VALUES.includes(normalized) ? normalized : null;
};

export const normalizeStep = (value) => (STEP_VALUES.includes(value) ? value : STEP_VALUES[0]);

/** Five display characters: `-` plus four digits for negatives, space padded otherwise. */
export const formatDigits = (value) => {
  const normalized = normalizeLife(value);
  if (normalized < 0) return `-${String(Math.abs(normalized)).padStart(4, " ")}`;
  return String(normalized).padStart(5, " ");
};

/** A typed "set value" is submittable when it is a finite, non-zero integer. */
export const parseSubmitValue = (text) => {
  if (typeof text !== "string" || text.trim() === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  const truncated = Math.trunc(parsed);
  return truncated === 0 ? null : truncated;
};

export const createPlayer = (id, name = `Player ${id}`) =>
  Object.freeze({ id, name, life: STARTING_LIFE, selectedStep: STEP_VALUES[0], initiative: null });

export const createState = () =>
  Object.freeze({ players: Object.freeze([createPlayer(1)]), nextPlayerId: 2, initiativeEnabled: false });

const withPlayers = (state, players, extra = {}) =>
  Object.freeze({ ...state, ...extra, players: Object.freeze(players) });

const updatePlayer = (state, playerId, update) => {
  if (!state.players.some((player) => player.id === playerId)) return state;
  return withPlayers(
    state,
    state.players.map((player) => (player.id === playerId ? Object.freeze({ ...player, ...update(player) }) : player))
  );
};

export const getPlayer = (state, playerId) => state.players.find((player) => player.id === playerId) ?? null;

export const addPlayer = (state) =>
  withPlayers(state, [...state.players, createPlayer(state.nextPlayerId)], {
    nextPlayerId: state.nextPlayerId + 1,
  });

/** Removing the last player leaves a fresh "Player 1" so the window never empties. */
export const removePlayer = (state, playerId) => {
  const players = state.players.filter((player) => player.id !== playerId);
  if (players.length) return withPlayers(state, players);
  return withPlayers(state, [createPlayer(state.nextPlayerId, "Player 1")], {
    nextPlayerId: state.nextPlayerId + 1,
  });
};

export const renamePlayer = (state, playerId, name) =>
  updatePlayer(state, playerId, () => ({ name: String(name ?? "") }));

export const setLife = (state, playerId, value, fallback) =>
  updatePlayer(state, playerId, (player) => ({ life: normalizeLife(value, fallback ?? player.life) }));

export const adjustLife = (state, playerId, direction) =>
  updatePlayer(state, playerId, (player) => ({
    life: normalizeLife(player.life + direction * normalizeStep(player.selectedStep), player.life),
  }));

export const selectStep = (state, playerId, step) =>
  STEP_VALUES.includes(step) ? updatePlayer(state, playerId, () => ({ selectedStep: step })) : state;

export const resetLife = (state) =>
  withPlayers(
    state,
    state.players.map((player) => Object.freeze({ ...player, life: STARTING_LIFE }))
  );

export const setInitiative = (state, playerId, value) => {
  const initiative = normalizeInitiative(value);
  return initiative === null ? state : updatePlayer(state, playerId, () => ({ initiative }));
};

export const setInitiativeEnabled = (state, enabled) =>
  Object.freeze({ ...state, initiativeEnabled: Boolean(enabled) });

/** Ids of every player sharing the highest initiative; empty when nobody has rolled. */
export const initiativeLeaders = (players) => {
  const rolled = players.filter((player) => normalizeInitiative(player.initiative) !== null);
  if (!rolled.length) return [];
  const highest = Math.max(...rolled.map((player) => player.initiative));
  return rolled.filter((player) => player.initiative === highest).map((player) => player.id);
};

/** Players in turn order: highest initiative first, ties by list position, unrolled last. */
export const initiativeOrder = (players) =>
  players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const aValue = normalizeInitiative(a.player.initiative);
      const bValue = normalizeInitiative(b.player.initiative);
      if (aValue === bValue) return a.index - b.index;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      return bValue - aValue;
    })
    .map(({ player }) => player);

export const rollInitiative = (random = Math.random) =>
  INITIATIVE_VALUES[Math.floor(random() * INITIATIVE_VALUES.length)];

/** The frames of one roll animation; the final frame is the real result. */
export const createRollSequence = (random = Math.random) => {
  const target = rollInitiative(random);
  return Array.from({ length: ROLL_FRAMES }, (_, index) =>
    index === ROLL_FRAMES - 1 ? target : rollInitiative(random)
  );
};

/** Milliseconds before frame `index + 1`: quick at first, slowing to a stop. */
export const rollDelay = (index) => {
  const progress = index / Math.max(1, ROLL_FRAMES - 1);
  return Math.round(36 + progress ** 2.45 * 245);
};

export const widthForColumns = (columns) =>
  Math.max(
    WINDOW_MIN_WIDTH,
    columns * WINDOW_COLUMN_WIDTH + Math.max(0, columns - 1) * WINDOW_COLUMN_GAP + WINDOW_EXTRA_WIDTH
  );

export const columnsForWidth = (width) => {
  const safeWidth = Number.isFinite(width) ? width : WINDOW_DEFAULT_WIDTH;
  const columns = Math.round(
    (safeWidth - WINDOW_EXTRA_WIDTH + WINDOW_COLUMN_GAP) / (WINDOW_COLUMN_WIDTH + WINDOW_COLUMN_GAP)
  );
  return Math.max(1, columns);
};

/** The widest the window may grow from `left` without leaving the viewport. */
export const maxWidthAtPosition = (viewportWidth, left = null) => {
  if (left === null) return Math.max(WINDOW_MIN_WIDTH, viewportWidth - WINDOW_VIEWPORT_PADDING * 2);
  return Math.max(WINDOW_MIN_WIDTH, viewportWidth - left - WINDOW_VIEWPORT_PADDING);
};

/** Rebuilds a valid state from persisted JSON; anything unusable becomes a fresh state. */
export const normalizeState = (raw) => {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.players)) return createState();
  const seen = new Set();
  const players = [];
  for (const entry of raw.players) {
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    players.push(
      Object.freeze({
        id,
        name: typeof entry.name === "string" ? entry.name : `Player ${id}`,
        life: normalizeLife(entry.life),
        selectedStep: normalizeStep(entry.selectedStep),
        initiative: normalizeInitiative(entry.initiative),
      })
    );
  }
  const highestId = players.reduce((max, player) => Math.max(max, player.id), 0);
  const storedNextId = Number.isInteger(raw.nextPlayerId) && raw.nextPlayerId > 0 ? raw.nextPlayerId : 1;
  let nextPlayerId = Math.max(highestId + 1, storedNextId);
  if (!players.length) {
    players.push(createPlayer(nextPlayerId, "Player 1"));
    nextPlayerId += 1;
  }
  return Object.freeze({
    players: Object.freeze(players),
    nextPlayerId,
    initiativeEnabled: Boolean(raw.initiativeEnabled),
  });
};
