// Neko motion rules: sprite tables, timing constants, pointer-chasing
// geometry, footprint placement, context-menu clamping and the taskbar
// stream plan. Pure functions only (no DOM) so node tests can import them.

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export const FRAME_INTERVAL_MS = 100;
export const SLEEP_FRAME_INTERVAL_MS = 850;
export const NAP_FRAME_SWITCH_FRAMES = 8;
export const SPEED = 10;
export const IDLE_DISTANCE = 48;
export const SPRITE_SIZE = 42;
export const VERTICAL_OFFSET = 10;
export const EDGE_SCRATCH_DISTANCE = 4;
export const EDGE_POINTER_HOTZONE = 2;
export const IDLE_ACTION_COOLDOWN_FRAMES = 14;
export const IDLE_ACTION_DELAY_MS = 1000;
export const MOUSE_STILL_SLEEP_MS = 5000;
export const EDGE_SCRATCH_SLEEP_MS = 4000;
export const RETURN_HOME_DISTANCE = 6;
export const FOOTPRINT_TTL_MS = 3000;
export const FOOTPRINT_MAX = 10;
export const FOOTPRINT_SPACING = 30;
export const FOOTPRINT_BACK_OFFSET = 12;
export const FOOTPRINT_SIDE_OFFSET = 6;
export const FOOTPRINT_STAGGER = 5;
export const CONTEXT_MENU_PADDING = 6;

export const DIRECTIONS = Object.freeze([
  "up",
  "upright",
  "right",
  "downright",
  "down",
  "downleft",
  "left",
  "upleft",
]);

export const SPRITE_NAMES = Object.freeze([
  "sleep1",
  "sleep2",
  "awake",
  "yawn1",
  "yawn2",
  "wash1",
  "scratch1",
  "scratch2",
  ...DIRECTIONS.flatMap((direction) => [`${direction}1`, `${direction}2`]),
  "upclaw1",
  "upclaw2",
  "rightclaw1",
  "rightclaw2",
  "downclaw1",
  "downclaw2",
  "leftclaw1",
  "leftclaw2",
]);

export const RUN_SPRITES = Object.freeze(
  Object.fromEntries(DIRECTIONS.map((direction) => [direction, Object.freeze([`${direction}1`, `${direction}2`])]))
);

export const FOOTPRINT_VISIBLE_OFFSETS = Object.freeze({
  up: { x: 0, y: 10.5 },
  upright: { x: -12, y: 11 },
  right: { x: -11.5, y: -1 },
  downright: { x: -12, y: -12 },
  down: { x: 0, y: -11.5 },
  downleft: { x: 11, y: -12 },
  left: { x: 10.5, y: 0 },
  upleft: { x: 11, y: 11 },
});

export const SCRATCH_SPRITES = Object.freeze({
  top: Object.freeze(["upclaw1", "upclaw2"]),
  right: Object.freeze(["rightclaw1", "rightclaw2"]),
  bottom: Object.freeze(["downclaw1", "downclaw2"]),
  left: Object.freeze(["leftclaw1", "leftclaw2"]),
});

export const SCRATCH_SELF_ACTION = Object.freeze({
  name: "scratchSelf",
  frames: Object.freeze(["scratch1", "scratch2", "scratch1", "scratch2", "scratch1", "scratch2"]),
});

export const YAWN_ACTION = Object.freeze({
  name: "yawn",
  frames: Object.freeze(["yawn1", "yawn2", "yawn2", "yawn1"]),
});

export const WASH_ACTION = Object.freeze({
  name: "wash",
  frames: Object.freeze(["wash1", "wash1", "wash1", "wash1", "wash1", "wash1"]),
});

export const AWAKE_ACTION = Object.freeze({
  name: "awake",
  frames: Object.freeze(["awake", "awake", "awake"]),
});

export const IDLE_ACTIONS = Object.freeze([SCRATCH_SELF_ACTION, YAWN_ACTION, WASH_ACTION]);

export const MANUAL_ACTIONS = Object.freeze([SCRATCH_SELF_ACTION, YAWN_ACTION, WASH_ACTION, AWAKE_ACTION]);

export const WAKE_SEQUENCE = Object.freeze([
  Object.freeze({ sprite: "awake", duration: 500 }),
  Object.freeze({ sprite: "yawn1", duration: 450 }),
  Object.freeze({ sprite: "yawn2", duration: 900, waitForRunAssets: true }),
  Object.freeze({ sprite: "wash1", duration: 900 }),
]);

/** The breathing frame of the sleeping bed icon (and the stream alert icon). */
export const sleepSpriteName = (frame) => (frame % 2 === 0 ? "sleep1" : "sleep2");

/** The nap frame of the active cat: switches every NAP_FRAME_SWITCH_FRAMES ticks. */
export const napSpriteName = (napFrame) =>
  Math.floor(napFrame / NAP_FRAME_SWITCH_FRAMES) % 2 === 0 ? "sleep1" : "sleep2";

/** Picks a run direction from the vector from target to cat (diff = cat - target). */
export const chooseRunDirection = (diffX, diffY, distance) => {
  const vertical = diffY / distance > 0.5 ? "up" : diffY / distance < -0.5 ? "down" : "";
  const horizontal = diffX / distance > 0.5 ? "left" : diffX / distance < -0.5 ? "right" : "";
  return `${vertical}${horizontal}` || "down";
};

export const clampCenterX = (x, viewportWidth) => {
  const halfSize = SPRITE_SIZE / 2;
  return clamp(x, halfSize, Math.max(halfSize, viewportWidth - halfSize));
};

/** CSS shifts the sprite up by VERTICAL_OFFSET, so stored Y sits below the visual centre. */
export const clampCenterY = (y, viewportHeight) => {
  const halfSize = SPRITE_SIZE / 2;
  const minY = halfSize + VERTICAL_OFFSET;
  return clamp(y, minY, Math.max(minY, viewportHeight - halfSize + VERTICAL_OFFSET));
};

export const clampTargetToViewport = (clientX, clientY, viewport) => ({
  x: clamp(clientX, 0, viewport.width),
  y: clamp(clientY, 0, viewport.height),
});

/** Where the cat sits to scratch `edge` nearest the (clamped) pointer. */
export const scratchAnchor = (edge, targetX, targetY, viewport) => {
  const halfSize = SPRITE_SIZE / 2;
  const logicalTargetY = targetY + VERTICAL_OFFSET;
  switch (edge) {
    case "left":
      return { x: halfSize, y: clampCenterY(logicalTargetY, viewport.height) };
    case "right":
      return {
        x: clampCenterX(viewport.width - halfSize, viewport.width),
        y: clampCenterY(logicalTargetY, viewport.height),
      };
    case "top":
      return { x: clampCenterX(targetX, viewport.width), y: halfSize + VERTICAL_OFFSET };
    case "bottom":
      return {
        x: clampCenterX(targetX, viewport.width),
        y: clampCenterY(viewport.height - halfSize + VERTICAL_OFFSET, viewport.height),
      };
    default:
      return { x: clampCenterX(targetX, viewport.width), y: clampCenterY(logicalTargetY, viewport.height) };
  }
};

/** The edge whose hot zone the pointer is inside, or null. */
export const pointerViewportEdge = (clientX, clientY, viewport) => {
  const candidates = [
    { edge: "left", distance: clientX, active: clientX <= EDGE_POINTER_HOTZONE },
    {
      edge: "right",
      distance: viewport.width - clientX,
      active: clientX >= viewport.width - EDGE_POINTER_HOTZONE,
    },
    { edge: "top", distance: clientY, active: clientY <= EDGE_POINTER_HOTZONE },
    {
      edge: "bottom",
      distance: viewport.height - clientY,
      active: clientY >= viewport.height - EDGE_POINTER_HOTZONE,
    },
  ].filter((candidate) => candidate.active);
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => (item.distance < best.distance ? item : best)).edge;
};

/** The edge the pointer left through: the largest overshoot, else the nearest edge. */
export const pointerExitEdge = (clientX, clientY, viewport) => {
  const overshoots = [
    { edge: "left", amount: Math.max(0, -clientX) },
    { edge: "right", amount: Math.max(0, clientX - viewport.width) },
    { edge: "top", amount: Math.max(0, -clientY) },
    { edge: "bottom", amount: Math.max(0, clientY - viewport.height) },
  ];
  const largest = overshoots.reduce((best, item) => (item.amount > best.amount ? item : best));
  if (largest.amount > 0) return largest.edge;
  return [
    { edge: "left", distance: Math.abs(clientX) },
    { edge: "right", distance: Math.abs(viewport.width - clientX) },
    { edge: "top", distance: Math.abs(clientY) },
    { edge: "bottom", distance: Math.abs(viewport.height - clientY) },
  ].reduce((best, item) => (item.distance < best.distance ? item : best)).edge;
};

/** Whether the cat at (x, y) has reached its scratch target or the raw edge. */
export const isAtScratchEdge = ({ edge, x, y, targetX, targetY, viewport }) => {
  if (Number.isFinite(targetX) && Number.isFinite(targetY)) {
    const distance = Math.sqrt((x - targetX) ** 2 + (y - targetY) ** 2);
    return distance <= SPEED + EDGE_SCRATCH_DISTANCE;
  }
  const halfSize = SPRITE_SIZE / 2;
  switch (edge) {
    case "left":
      return x <= halfSize + EDGE_SCRATCH_DISTANCE;
    case "right":
      return x >= viewport.width - halfSize - EDGE_SCRATCH_DISTANCE;
    case "top":
      return y <= halfSize + VERTICAL_OFFSET + EDGE_SCRATCH_DISTANCE;
    case "bottom":
      return y >= viewport.height - halfSize + VERTICAL_OFFSET - EDGE_SCRATCH_DISTANCE;
    default:
      return false;
  }
};

/**
 * One 100ms step toward a target. Returns `{ arrived: true }` within
 * `stopDistance` (or one step), otherwise the new clamped position, the
 * movement vector and the run direction for sprite selection.
 */
export const stepTowardTarget = ({ x, y, targetX, targetY, stopDistance, viewport }) => {
  const diffX = x - targetX;
  const diffY = y - targetY;
  const distance = Math.sqrt(diffX ** 2 + diffY ** 2);
  if (distance <= stopDistance || distance < SPEED) return { arrived: true };
  const direction = chooseRunDirection(diffX, diffY, distance);
  const moveX = -(diffX / distance) * SPEED;
  const moveY = -(diffY / distance) * SPEED;
  return {
    arrived: false,
    direction,
    moveX,
    moveY,
    x: clampCenterX(x + moveX, viewport.width),
    y: clampCenterY(y + moveY, viewport.height),
  };
};

/** Whether the cat has travelled far enough from the last print to drop another pair. */
export const shouldDropFootprint = (lastX, lastY, x, y) => {
  if (lastX === null || lastY === null) return true;
  return Math.sqrt((x - lastX) ** 2 + (y - lastY) ** 2) >= FOOTPRINT_SPACING;
};

/** Two paw prints behind the cat, staggered left/right; `side` is +1 or -1 for the first paw. */
export const footprintPairPositions = ({ x, y, moveX, moveY, side }) => {
  const distance = Math.sqrt(moveX ** 2 + moveY ** 2) || 1;
  const alongX = moveX / distance;
  const alongY = moveY / distance;
  const sideX = -alongY;
  const sideY = alongX;
  const originX = x - alongX * FOOTPRINT_BACK_OFFSET;
  const originY = y - VERTICAL_OFFSET - alongY * FOOTPRINT_BACK_OFFSET;
  const paw = (pawSide, stagger) => ({
    x: originX + sideX * FOOTPRINT_SIDE_OFFSET * pawSide + alongX * stagger,
    y: originY + sideY * FOOTPRINT_SIDE_OFFSET * pawSide + alongY * stagger,
    side: pawSide,
  });
  return [paw(side, -FOOTPRINT_STAGGER), paw(-side, FOOTPRINT_STAGGER)];
};

/** CSS left/top for a footprint sprite so its visible paw lands on (x, y). */
export const footprintPlacement = (x, y, direction) => {
  const offset = FOOTPRINT_VISIBLE_OFFSETS[direction] || { x: 0, y: 0 };
  return { left: Math.round(x - offset.x), top: Math.round(y - offset.y) };
};

/** The logical cat position for a bed/icon rectangle (`{ left, top, width, height }`). */
export const homePositionFromRect = (rect, viewport) => {
  if (rect?.width && rect?.height) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + VERTICAL_OFFSET };
  }
  return { x: viewport.width / 2, y: viewport.height / 2 };
};

/** Keeps the context menu inside the viewport and above the taskbar. */
export const contextMenuPosition = ({
  requestedLeft,
  requestedTop,
  menuWidth,
  menuHeight,
  viewport,
  taskbarTop = null,
  padding = CONTEXT_MENU_PADDING,
}) => {
  const availableBottom = Math.min(viewport.height - padding, taskbarTop ?? viewport.height - padding);
  const maximumLeft = Math.max(padding, viewport.width - menuWidth - padding);
  const maximumTop = Math.max(padding, availableBottom - menuHeight - padding);
  return {
    left: Math.round(clamp(requestedLeft, padding, maximumLeft)),
    top: Math.round(clamp(requestedTop, padding, maximumTop)),
  };
};

// ------------------------------------------------------------ taskbar stream

export const STREAM_COUNT = 40;
export const STREAM_SPAWN_WINDOW_MS = 10_000;
export const STREAM_MIN_SPEED_MULTIPLIER = 0.8;
export const STREAM_MAX_SPEED_MULTIPLIER = 1.7;
export const STREAM_ACTION_CHANCE = 0.25;
export const STREAM_ACTION_PROGRESS_MIN = 0.2;
export const STREAM_ACTION_PROGRESS_MAX = 0.8;
export const STREAM_NON_SLEEP_ACTION_MIN_MS = 5_000;
export const STREAM_NON_SLEEP_ACTION_MAX_MS = 10_000;
export const STREAM_YAWN_ACTION_DURATION_MS = 3_000;
export const STREAM_SLEEP_ACTION_DURATION_MS = 20_000;
export const STREAM_CLEAN_SIT_PHASE_MS = 1_000;
export const STREAM_CLEAN_WASH_PHASE_MS = 2_000;
export const STREAM_CLEAN_CYCLE_MS = STREAM_CLEAN_SIT_PHASE_MS + STREAM_CLEAN_WASH_PHASE_MS;
export const STREAM_OFFSCREEN_MARGIN = SPRITE_SIZE * 2;
export const STREAM_SOURCE_SIZE_PX = 32;
export const STREAM_BASE_OPAQUE_HEIGHT_PX = 30;
export const STREAM_MAX_OPAQUE_BOTTOM_RATIO = STREAM_BASE_OPAQUE_HEIGHT_PX / STREAM_SOURCE_SIZE_PX;
export const STREAM_SLEEP_OVERLAP_PX = 1;
export const STREAM_FALLBACK_TASKBAR_HEIGHT_PX = 52;

/** Measured opaque pixel rows (of 32) per sprite; keeps every pose touching the taskbar. */
export const STREAM_OPAQUE_HEIGHT_BY_SPRITE = Object.freeze({
  left1: 27,
  left2: 26,
  right1: 27,
  right2: 26,
  awake: 29,
  scratch1: 29,
  scratch2: 29,
  wash1: 29,
  yawn1: 29,
  yawn2: 29,
  sleep1: 30,
  sleep2: 30,
});

export const STREAM_ACTIONS = Object.freeze([
  Object.freeze({ name: "sit", frames: AWAKE_ACTION.frames }),
  Object.freeze({ name: "scratch", frames: SCRATCH_SELF_ACTION.frames }),
  Object.freeze({ name: "clean", frames: Object.freeze([AWAKE_ACTION.frames[0], WASH_ACTION.frames[0]]) }),
  Object.freeze({ name: "yawn", frames: YAWN_ACTION.frames, fixedDurationMs: STREAM_YAWN_ACTION_DURATION_MS }),
  Object.freeze({
    name: "sleep",
    frames: Object.freeze(["sleep1", "sleep2"]),
    fixedDurationMs: STREAM_SLEEP_ACTION_DURATION_MS,
  }),
]);

/** A random roll clamped to [0, 1]; non-finite samples count as 0. */
export const sampleRoll = (random = Math.random) => {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
};

export const sampleRange = (minimum, maximum, random = Math.random) =>
  Math.min(maximum, minimum + sampleRoll(random) * (maximum - minimum));

export const sampleIndex = (length, random = Math.random) =>
  Math.min(length - 1, Math.floor(sampleRoll(random) * length));

const sampleSpawnSlotRoll = (random) => Math.min(sampleRoll(random), 1 - 1e-9);

/**
 * Plans one stream: `count` cats in consecutive equal spawn slots across
 * `durationMs`, each with a random offset inside its slot, an entry side,
 * a bounded speed and (with STREAM_ACTION_CHANCE) one mid-crossing action.
 * Sorted by spawn delay.
 */
export const createStreamPlan = ({
  count = STREAM_COUNT,
  durationMs = STREAM_SPAWN_WINDOW_MS,
  random = Math.random,
} = {}) => {
  const slotDurationMs = count > 0 ? durationMs / count : 0;
  const plans = Array.from({ length: count }, (_, id) => {
    const spawnDelayMs = id * slotDurationMs + sampleSpawnSlotRoll(random) * slotDurationMs;
    const entrySide = sampleRoll(random) < 0.5 ? "left" : "right";
    const initialDirection = entrySide === "left" ? 1 : -1;
    const initialSpeedMultiplier = sampleRange(STREAM_MIN_SPEED_MULTIPLIER, STREAM_MAX_SPEED_MULTIPLIER, random);
    const action =
      sampleRoll(random) < STREAM_ACTION_CHANCE ? STREAM_ACTIONS[sampleIndex(STREAM_ACTIONS.length, random)] : null;
    const base = {
      id,
      spawnDelayMs,
      entrySide,
      initialDirection,
      initialSpeedMultiplier,
      action: null,
      actionTriggerProgress: null,
      actionDurationMs: null,
      postActionDirection: null,
      postActionSpeedMultiplier: null,
    };
    if (!action) return Object.freeze(base);
    return Object.freeze({
      ...base,
      action,
      actionTriggerProgress: sampleRange(STREAM_ACTION_PROGRESS_MIN, STREAM_ACTION_PROGRESS_MAX, random),
      actionDurationMs:
        action.fixedDurationMs ??
        sampleRange(STREAM_NON_SLEEP_ACTION_MIN_MS, STREAM_NON_SLEEP_ACTION_MAX_MS, random),
    });
  });
  return Object.freeze(plans.sort((first, second) => first.spawnDelayMs - second.spawnDelayMs));
};

export const isOutsideViewport = (x, viewportWidth, margin = STREAM_OFFSCREEN_MARGIN) =>
  x < -margin || x > viewportWidth + margin;

/** Vertical correction so a sprite's lowest opaque row sits on the taskbar. */
export const streamPoseOffsetY = (spriteName) => {
  const opaqueHeight = STREAM_OPAQUE_HEIGHT_BY_SPRITE[spriteName] ?? STREAM_BASE_OPAQUE_HEIGHT_PX;
  const baselineCorrection = ((STREAM_BASE_OPAQUE_HEIGHT_PX - opaqueHeight) * SPRITE_SIZE) / STREAM_SOURCE_SIZE_PX;
  const overlap = spriteName.startsWith("sleep") ? STREAM_SLEEP_OVERLAP_PX : 0;
  return baselineCorrection + overlap;
};

/** The lane's CSS top for a taskbar top edge (or the fallback when the taskbar is missing). */
export const streamLaneY = (taskbarTop, viewportHeight) => {
  const top = Number.isFinite(taskbarTop) ? taskbarTop : viewportHeight - STREAM_FALLBACK_TASKBAR_HEIGHT_PX;
  return top - SPRITE_SIZE * STREAM_MAX_OPAQUE_BOTTOM_RATIO;
};

export const streamEntryProgress = (cat, viewportWidth) => {
  if (viewportWidth <= 0) return 0;
  return cat.entrySide === "left" ? cat.x / viewportWidth : (viewportWidth - cat.x) / viewportWidth;
};

export const isStreamCatFullyVisible = (cat, viewportWidth) => {
  const halfSprite = SPRITE_SIZE / 2;
  return cat.x >= halfSprite && cat.x <= viewportWidth - halfSprite;
};

/** Whether a running cat with a pending action should start it now. */
export const shouldStartStreamAction = (cat, viewportWidth) =>
  Boolean(cat.action) &&
  !cat.actionCompleted &&
  cat.actionStartedAt === null &&
  isStreamCatFullyVisible(cat, viewportWidth) &&
  streamEntryProgress(cat, viewportWidth) >= cat.actionTriggerProgress;

/** Horizontal travel for `deltaMs` at the canonical speed times a multiplier. */
export const streamStepX = (direction, speedMultiplier, deltaMs) =>
  direction * SPEED * speedMultiplier * (deltaMs / FRAME_INTERVAL_MS);

/** Advances the two-frame run cycle; returns `{ runFrameIndex, runFrameElapsedMs, changed }`. */
export const advanceRunFrame = (runFrameIndex, runFrameElapsedMs, deltaMs) => {
  const elapsed = runFrameElapsedMs + deltaMs;
  if (elapsed < FRAME_INTERVAL_MS) return { runFrameIndex, runFrameElapsedMs: elapsed, changed: false };
  const steps = Math.floor(elapsed / FRAME_INTERVAL_MS);
  return {
    runFrameIndex: (runFrameIndex + steps) % 2,
    runFrameElapsedMs: elapsed % FRAME_INTERVAL_MS,
    changed: true,
  };
};

/** The sprite an action shows `elapsedMs` after it started. */
export const streamActionSpriteName = (action, elapsedMs) => {
  const safeElapsedMs = Math.max(0, Number(elapsedMs) || 0);
  if (action.name === "clean") {
    const cycleElapsedMs = safeElapsedMs % STREAM_CLEAN_CYCLE_MS;
    return action.frames[cycleElapsedMs < STREAM_CLEAN_SIT_PHASE_MS ? 0 : 1];
  }
  if (action.name === "yawn") {
    const frameDurationMs = STREAM_YAWN_ACTION_DURATION_MS / action.frames.length;
    return action.frames[Math.min(action.frames.length - 1, Math.floor(safeElapsedMs / frameDurationMs))];
  }
  const frameIntervalMs = action.name === "sleep" ? NAP_FRAME_SWITCH_FRAMES * FRAME_INTERVAL_MS : FRAME_INTERVAL_MS;
  return action.frames[Math.floor(safeElapsedMs / frameIntervalMs) % action.frames.length];
};

/** Clamps a frame delta so a background tab does not teleport the cats. */
export const clampFrameDelta = (deltaMs) => clamp(deltaMs, 0, FRAME_INTERVAL_MS * 2);
