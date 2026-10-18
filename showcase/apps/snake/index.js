// Snake: the game window (CRT board, readouts, settings panel, touch pad),
// its loading sequence, keyboard and touch input, rendering and local high
// scores, plus the rules window. The pure engine lives in rules.js.

import {
  clamp,
  createProgressLoader,
  debounceTimer,
  isPageActive,
  isWindowOpen,
  openWindow,
  prefersReducedMotion,
  reducedMotionQuery,
  storage,
} from "../../kit/index.js";
import { clearNoiseCanvas, drawNoiseCanvas } from "./static-noise.js";
import {
  BOARD_SIZES,
  DIRECTIONS,
  SNAKE_COUNTDOWN_MS,
  SNAKE_TICK_MS,
  directionsOppose,
  generate,
  initial,
  step,
  transition,
} from "./rules.js";

const APP_ID = "snake";
const RULES_ID = "snake-rules";
const DEFAULT_GRID_SIZE = 16;
const HIGH_SCORE_KEY = "win98SiteKit.snake.highScores";
const SETTINGS_KEY = "win98SiteKit.snake.settings";
const HIGH_SCORE_SAVE_DEBOUNCE_MS = 350;
const LOAD_MIN_MS = 1000;
const LOAD_MAX_MS = 4000;
const SIGNATURE_SWEEP_MS = 3200;
const SIGNATURE_SWEEP_CELL_RADIUS = 2;
const COLLECTION_PULSE_MS = 820;
const COLLECTION_PULSE_CELL_RADIUS = 2.5;
const RENDER_INTERVAL_MS = 1000 / 24;
const NOISE_INTERVAL_MS = 1000 / 16;
const POINTER_PAUSE_SUPPRESSION_MS = 250;

const COLOR_THEMES = Object.freeze({
  green: {
    head: "#62ff78",
    body: "#2f9a4b",
    glow: "rgba(98, 255, 120, 0.75)",
    sweepRing: "rgba(98, 255, 120, 0.16)",
    pulse: (alpha) => `rgba(98, 255, 120, ${alpha})`,
  },
  purple: {
    head: "#c77dff",
    body: "#7b2cbf",
    glow: "rgba(199, 125, 255, 0.75)",
    sweepRing: "rgba(199, 125, 255, 0.16)",
    pulse: (alpha) => `rgba(199, 125, 255, ${alpha})`,
  },
  red: {
    head: "#ff6257",
    body: "#a8211d",
    glow: "rgba(255, 98, 87, 0.75)",
    sweepRing: "rgba(255, 98, 87, 0.16)",
    pulse: (alpha) => `rgba(255, 98, 87, ${alpha})`,
  },
  blue: {
    head: "#65b7ff",
    body: "#2368c4",
    glow: "rgba(101, 183, 255, 0.75)",
    sweepRing: "rgba(101, 183, 255, 0.16)",
    pulse: (alpha) => `rgba(101, 183, 255, ${alpha})`,
  },
});

const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: "up",
  w: "up",
  W: "up",
  ArrowDown: "down",
  s: "down",
  S: "down",
  ArrowLeft: "left",
  a: "left",
  A: "left",
  ArrowRight: "right",
  d: "right",
  D: "right",
});

const state = {
  snake: [],
  apples: [],
  collectionPulses: [],
  direction: "right",
  directionQueue: [],
  score: 0,
  gridSize: DEFAULT_GRID_SIZE,
  color: "green",
  appleColor: "red",
  highScores: {},
  running: false,
  hasStarted: false,
  gameOver: false,
  tickTimer: null,
  countdownTimer: null,
  countdownStartedAt: 0,
  countdownDuration: 0,
  noiseFrame: null,
  loading: false,
  engineState: null,
  bufferedDirections: [],
};

// Elements, resolved once in mount().
const ui = {
  window: null,
  loadingPanel: null,
  loadingMeter: null,
  loadingMeterFill: null,
  loadingPercent: null,
  canvas: null,
  noiseCanvas: null,
  status: null,
  score: null,
  highScore: null,
  start: null,
  boardSizeButtons: [],
  colorButtons: [],
  appleColorButtons: [],
};

let pointerPauseSuppressUntil = 0;
let gridCanvas = null;
let gridCacheKey = "";
let highScoreSaveTimer = null;
let renderDirty = true;
let lastRenderAt = 0;
let lastNoiseAt = 0;
const hudCache = {
  score: "",
  highScore: "",
  startText: "",
  statusText: "",
  gridSize: null,
  color: "",
  appleColor: "",
};

const isSnakeWindowVisible = () => isWindowOpen(APP_ID);

const canAnimate = () => isSnakeWindowVisible() && isPageActive(document) && !prefersReducedMotion();

const focusBoard = () => {
  if (ui.canvas) ui.canvas.focus({ preventScroll: true });
};

const requestRender = () => {
  renderDirty = true;
  startNoiseAnimation();
};

const clearCountdown = () => {
  if (state.countdownTimer) {
    clearTimeout(state.countdownTimer);
    state.countdownTimer = null;
  }
  state.countdownStartedAt = 0;
  state.countdownDuration = 0;
};

// Loading sequence ---------------------------------------------------------

const setLoadingProgress = (progress) => {
  const rounded = Math.round(clamp(progress, 0, 100));
  ui.loadingMeterFill?.style.setProperty("--snake-load-progress", `${rounded}%`);
  ui.loadingMeter?.setAttribute("aria-valuenow", String(rounded));
  if (ui.loadingPercent) ui.loadingPercent.textContent = `${rounded}%`;
};

const setLoadingVisible = (visible) => {
  state.loading = visible;
  ui.window?.classList.toggle("is-snake-loading", visible);
  ui.loadingPanel?.setAttribute("aria-hidden", String(!visible));
};

const finishLoadingSequence = () => {
  setLoadingVisible(false);
  if (!isSnakeWindowVisible()) return;
  requestRender();
  focusBoard();
};

const progressLoader = createProgressLoader({
  progressCap: 96,
  shouldContinue: () => state.loading && isSnakeWindowVisible(),
  nextProgress: ({ elapsedMs, durationMs, progress }) => {
    const timeProgress = (elapsedMs / durationMs) * 100;
    const naturalJump = 4 + Math.random() * 18;
    const catchupJump = Math.max(0, timeProgress - progress) * (0.45 + Math.random() * 0.5);
    const jitterCap = timeProgress + 14 + Math.random() * 18;
    return Math.max(progress + 1, Math.min(jitterCap, progress + naturalJump + catchupJump));
  },
  nextDelay: ({ elapsedMs, durationMs }) =>
    Math.min(110 + Math.random() * 290, Math.max(0, durationMs - elapsedMs)),
  onProgress: setLoadingProgress,
  onReady: finishLoadingSequence,
});

const clearLoadingSequence = () => {
  progressLoader.cancel();
  setLoadingVisible(false);
  setLoadingProgress(0);
};

const startLoadingSequence = () => {
  pauseGame();
  stopNoiseAnimation();
  clearCountdown();
  setLoadingVisible(true);
  progressLoader.start({
    duration: LOAD_MIN_MS + Math.random() * (LOAD_MAX_MS - LOAD_MIN_MS),
    initialDelay: 120 + Math.random() * 220,
  });
};

// Persistence --------------------------------------------------------------

const loadHighScores = () => {
  const stored = storage.readJson(HIGH_SCORE_KEY, {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
};

const saveHighScores = () => {
  if (highScoreSaveTimer) {
    clearTimeout(highScoreSaveTimer);
    highScoreSaveTimer = null;
  }
  storage.writeJson(HIGH_SCORE_KEY, state.highScores);
};

const scheduleHighScoreSave = () => {
  highScoreSaveTimer = debounceTimer(highScoreSaveTimer, saveHighScores, HIGH_SCORE_SAVE_DEBOUNCE_MS);
};

const loadSettings = () => {
  const stored = storage.readJson(SETTINGS_KEY, null);
  if (!stored || typeof stored !== "object") return null;
  const gridSize = Number(stored.gridSize);
  return {
    gridSize: BOARD_SIZES.includes(gridSize) ? gridSize : DEFAULT_GRID_SIZE,
    color: COLOR_THEMES[stored.color] ? stored.color : "green",
    appleColor: COLOR_THEMES[stored.appleColor] ? stored.appleColor : "red",
  };
};

const saveSettings = () => {
  storage.writeJson(SETTINGS_KEY, {
    gridSize: state.gridSize,
    color: state.color,
    appleColor: state.appleColor,
  });
};

const getHighScore = () => {
  const score = Number(state.highScores[String(state.gridSize)]);
  return Number.isFinite(score) ? score : 0;
};

const updateHighScore = () => {
  if (state.score <= getHighScore()) return;
  state.highScores[String(state.gridSize)] = state.score;
  scheduleHighScoreSave();
};

// HUD ----------------------------------------------------------------------

const markSelected = (buttons, isSelected) => {
  buttons.forEach((button) => {
    const selected = isSelected(button);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
};

const getColorTheme = () => COLOR_THEMES[state.color] || COLOR_THEMES.green;

const getAppleColorTheme = () => COLOR_THEMES[state.appleColor] || COLOR_THEMES.red;

const statusText = () => {
  if (state.gameOver) return "Signal lost";
  if (state.countdownTimer) return "Starting";
  if (state.running) return "Tracking";
  if (state.hasStarted) return "Paused - press Start";
  return "Ready";
};

const updateHud = () => {
  const scoreText = String(state.score);
  const highScoreText = String(getHighScore());
  const startText = state.running || state.countdownTimer ? "Pause" : "Start";
  if (ui.score && hudCache.score !== scoreText) ui.score.textContent = scoreText;
  if (ui.highScore && hudCache.highScore !== highScoreText) ui.highScore.textContent = highScoreText;
  if (ui.start && hudCache.startText !== startText) ui.start.textContent = startText;
  if (hudCache.gridSize !== state.gridSize) {
    markSelected(ui.boardSizeButtons, (button) => Number(button.dataset.snakeBoardSize) === state.gridSize);
  }
  if (hudCache.color !== state.color) {
    markSelected(ui.colorButtons, (button) => button.dataset.snakeColor === state.color);
  }
  if (hudCache.appleColor !== state.appleColor) {
    markSelected(ui.appleColorButtons, (button) => button.dataset.snakeAppleColor === state.appleColor);
  }
  const status = statusText();
  if (ui.status && hudCache.statusText !== status) ui.status.textContent = status;
  Object.assign(hudCache, {
    score: scoreText,
    highScore: highScoreText,
    startText,
    statusText: status,
    gridSize: state.gridSize,
    color: state.color,
    appleColor: state.appleColor,
  });
};

// Rendering ----------------------------------------------------------------

const resizeCanvas = (canvas) => {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth || 320));
  const height = Math.max(1, Math.round(canvas.clientHeight || width));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height, ratio };
};

const getGridLayer = (width, height, ratio) => {
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  const cacheKey = `${pixelWidth}x${pixelHeight}:${ratio}:${state.gridSize}`;
  if (!gridCanvas) gridCanvas = document.createElement("canvas");
  if (gridCacheKey === cacheKey && gridCanvas.width === pixelWidth && gridCanvas.height === pixelHeight) {
    return gridCanvas;
  }
  gridCacheKey = cacheKey;
  gridCanvas.width = pixelWidth;
  gridCanvas.height = pixelHeight;
  const gridCtx = gridCanvas.getContext("2d");
  if (!gridCtx) return gridCanvas;
  const cellWidth = width / state.gridSize;
  const cellHeight = height / state.gridSize;
  gridCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  gridCtx.clearRect(0, 0, width, height);
  gridCtx.fillStyle = "#020403";
  gridCtx.fillRect(0, 0, width, height);
  gridCtx.strokeStyle = "rgba(95, 255, 122, 0.14)";
  gridCtx.lineWidth = 1;
  for (let x = 0; x <= state.gridSize; x += 1) {
    const px = x * cellWidth;
    gridCtx.beginPath();
    gridCtx.moveTo(px, 0);
    gridCtx.lineTo(px, height);
    gridCtx.stroke();
  }
  for (let y = 0; y <= state.gridSize; y += 1) {
    const py = y * cellHeight;
    gridCtx.beginPath();
    gridCtx.moveTo(0, py);
    gridCtx.lineTo(width, py);
    gridCtx.stroke();
  }
  return gridCanvas;
};

const drawOverlayBand = (ctx, width, centerY, bandHeight, alpha) => {
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, centerY - bandHeight / 2, width, bandHeight);
};

const drawGame = () => {
  const prepared = resizeCanvas(ui.canvas);
  if (!prepared) return;
  const { ctx, width, height, ratio } = prepared;
  const cellWidth = width / state.gridSize;
  const cellHeight = height / state.gridSize;

  ctx.drawImage(getGridLayer(width, height, ratio), 0, 0, width, height);

  const snakeTheme = getColorTheme();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = snakeTheme.glow;
  ctx.shadowBlur = 7;
  state.snake.forEach((segment, index) => {
    const inset = index === 0 ? 2 : 3;
    const segmentScale = 0.8;
    const baseX = segment.x * cellWidth + inset;
    const baseY = segment.y * cellHeight + inset;
    const baseWidth = cellWidth - inset * 2;
    const baseHeight = cellHeight - inset * 2;
    const segmentWidth = baseWidth * segmentScale;
    const segmentHeight = baseHeight * segmentScale;
    ctx.fillStyle = index === 0 ? snakeTheme.head : snakeTheme.body;
    ctx.fillRect(
      baseX + (baseWidth - segmentWidth) / 2,
      baseY + (baseHeight - segmentHeight) / 2,
      segmentWidth,
      segmentHeight
    );
  });
  ctx.restore();

  const now = performance.now();
  const appleTheme = getAppleColorTheme();
  state.apples.forEach((apple) => {
    const appleX = apple.x * cellWidth + cellWidth / 2;
    const appleY = apple.y * cellHeight + cellHeight / 2;
    const cellSize = Math.min(cellWidth, cellHeight);
    const dotRadius = Math.max(2.2, cellSize * 0.16);
    const ringRadius = Math.max(dotRadius + 2, cellSize * 0.38);
    const sweepRadius = cellSize * SIGNATURE_SWEEP_CELL_RADIUS;
    const sweepOffset = Number.isFinite(apple.sweepOffset) ? apple.sweepOffset : 0;
    const sweepAngle = ((now / SIGNATURE_SWEEP_MS + sweepOffset) % 1) * Math.PI * 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = appleTheme.glow;
    ctx.shadowBlur = Math.max(5, cellSize * 0.35);
    for (let trailIndex = 0; trailIndex < 18; trailIndex += 1) {
      const trailStart = trailIndex / 18;
      const trailEnd = (trailIndex + 1) / 18;
      const startAngle = sweepAngle - trailEnd * 0.95;
      const endAngle = sweepAngle - trailStart * 0.95;
      const trailAlpha = 0.025 + (1 - trailStart) ** 1.8 * 0.17;
      ctx.fillStyle = appleTheme.pulse(trailAlpha);
      ctx.beginPath();
      ctx.arc(appleX, appleY, sweepRadius, startAngle, endAngle);
      ctx.arc(appleX, appleY, ringRadius + 1, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineCap = "round";
    ctx.shadowBlur = Math.max(6, cellSize * 0.42);
    ctx.strokeStyle = appleTheme.pulse(0.4);
    ctx.lineWidth = Math.max(1.5, cellSize * 0.12);
    ctx.beginPath();
    ctx.moveTo(appleX + Math.cos(sweepAngle) * (ringRadius + 1), appleY + Math.sin(sweepAngle) * (ringRadius + 1));
    ctx.lineTo(appleX + Math.cos(sweepAngle) * sweepRadius, appleY + Math.sin(sweepAngle) * sweepRadius);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = appleTheme.sweepRing;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(appleX, appleY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = appleTheme.head;
    ctx.shadowColor = appleTheme.glow;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(appleX, appleY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  state.collectionPulses = state.collectionPulses.filter((pulse) => now - pulse.startedAt < COLLECTION_PULSE_MS);
  state.collectionPulses.forEach((pulse) => {
    const progress = clamp((now - pulse.startedAt) / COLLECTION_PULSE_MS, 0, 1);
    const pulseX = pulse.x * cellWidth + cellWidth / 2;
    const pulseY = pulse.y * cellHeight + cellHeight / 2;
    const cellSize = Math.min(cellWidth, cellHeight);
    const radius = Math.max(2.5, cellSize * (0.18 + progress * (COLLECTION_PULSE_CELL_RADIUS - 0.18)));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = appleTheme.pulse((1 - progress) * 0.46);
    ctx.lineWidth = 1 + (1 - progress) * 0.7;
    ctx.beginPath();
    ctx.arc(pulseX, pulseY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (state.gameOver) {
    drawOverlayBand(ctx, width, height / 2, 56, 0.42);
    ctx.fillStyle = "rgba(98, 255, 120, 0.9)";
    ctx.font = "bold 16px 'Courier New', monospace";
    ctx.fillText("SIGNAL LOST", width / 2, height / 2 - 9);
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillText("Press RESET or ENTER to try again.", width / 2, height / 2 + 12);
  } else if (!state.hasStarted && !state.loading) {
    ctx.save();
    drawOverlayBand(ctx, width, height / 2, 48, 0.34);
    ctx.fillStyle = "rgba(98, 255, 120, 0.92)";
    ctx.shadowColor = "rgba(98, 255, 120, 0.82)";
    ctx.shadowBlur = 10;
    ctx.font = "bold 15px 'Courier New', monospace";
    ctx.fillText("Press Any Key to Begin", width / 2, height / 2);
    ctx.restore();
  } else if (state.countdownTimer) {
    const remaining = Math.max(0, state.countdownDuration - (performance.now() - state.countdownStartedAt));
    const count = Math.max(1, Math.ceil((remaining / state.countdownDuration) * 3));
    ctx.save();
    drawOverlayBand(ctx, width, height / 2, 60, 0.38);
    ctx.fillStyle = "rgba(98, 255, 120, 0.95)";
    ctx.shadowColor = "rgba(98, 255, 120, 0.82)";
    ctx.shadowBlur = 14;
    ctx.font = "bold 24px 'Courier New', monospace";
    ctx.fillText(String(count), width / 2, height / 2);
    ctx.restore();
  } else if (state.hasStarted && !state.running) {
    const barWidth = Math.max(8, width * 0.035);
    const barHeight = Math.max(40, height * 0.16);
    const gap = Math.max(10, width * 0.04);
    const barX = width / 2 - gap / 2 - barWidth;
    const barY = height / 2 - barHeight / 2;
    ctx.save();
    drawOverlayBand(ctx, width, height / 2, barHeight * 1.4, 0.34);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(98, 255, 120, 0.92)";
    ctx.shadowColor = "rgba(98, 255, 120, 0.82)";
    ctx.shadowBlur = 12;
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillRect(barX + barWidth + gap, barY, barWidth, barHeight);
    ctx.restore();
  }
};

const drawNoise = () => {
  if (!isSnakeWindowVisible() || prefersReducedMotion()) {
    clearNoiseCanvas(ui.noiseCanvas);
    return;
  }
  drawNoiseCanvas(ui.noiseCanvas);
};

const stopNoiseAnimation = () => {
  if (!state.noiseFrame) return;
  cancelAnimationFrame(state.noiseFrame);
  state.noiseFrame = null;
};

const startNoiseAnimation = () => {
  if (state.noiseFrame) return;
  const animate = (timestamp) => {
    state.noiseFrame = null;
    if (!isSnakeWindowVisible()) return;
    const hasAnimatedGame =
      state.running || state.countdownTimer || state.gameOver || state.collectionPulses.length > 0;
    const allowAnimation = canAnimate();
    const shouldDrawGame =
      renderDirty || (allowAnimation && hasAnimatedGame && timestamp - lastRenderAt >= RENDER_INTERVAL_MS);
    if (shouldDrawGame) {
      drawGame();
      renderDirty = false;
      lastRenderAt = timestamp;
    }
    if (allowAnimation && timestamp - lastNoiseAt >= NOISE_INTERVAL_MS) {
      drawNoise();
      lastNoiseAt = timestamp;
    } else if (!allowAnimation) {
      clearNoiseCanvas(ui.noiseCanvas);
    }
    if (renderDirty || (allowAnimation && hasAnimatedGame)) {
      state.noiseFrame = requestAnimationFrame(animate);
    }
  };
  state.noiseFrame = requestAnimationFrame(animate);
};

// Engine bridge ------------------------------------------------------------

const randomSeed = () => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;

const syncEngineState = () => {
  const engine = state.engineState;
  if (!engine) return;
  const previousApples = new Map(state.apples.map((apple) => [`${apple.x},${apple.y}`, apple]));
  state.gridSize = Number(engine.configuration.boardSize);
  state.snake = engine.snake.map(({ x, y }) => ({ x, y }));
  state.apples = engine.apples.map(({ x, y }) => ({
    x,
    y,
    sweepOffset: previousApples.get(`${x},${y}`)?.sweepOffset ?? Math.random(),
  }));
  state.direction = engine.direction;
  state.directionQueue = engine.directionQueue.slice();
  state.score = engine.score;
  state.gameOver = engine.terminal;
};

const installFreshBoard = () => {
  state.engineState = initial(generate({ boardSize: String(state.gridSize) }, { seed: randomSeed() }));
  syncEngineState();
};

const recordDirection = (direction) => {
  const engine = state.engineState;
  if (!engine) return false;
  try {
    transition(engine, { seq: engine.nextSeq, op: "direction", tick: engine.tick, direction });
  } catch (error) {
    if (error?.code === "illegal-action") return false;
    throw error;
  }
  syncEngineState();
  return true;
};

const clearTick = () => {
  if (!state.tickTimer) return;
  clearTimeout(state.tickTimer);
  state.tickTimer = null;
};

const setDirection = (direction) => {
  if (!DIRECTIONS[direction]) return;
  if (!state.running && !state.countdownTimer) {
    const engineQueue = state.engineState?.directionQueue || [];
    const base = state.bufferedDirections.at(-1) || engineQueue.at(-1) || state.engineState?.direction || "right";
    if (
      engineQueue.length + state.bufferedDirections.length >= 2 ||
      direction === base ||
      directionsOppose(base, direction)
    ) {
      return;
    }
    state.bufferedDirections.push(direction);
    return;
  }
  recordDirection(direction);
};

// Game flow ----------------------------------------------------------------

const resetGame = () => {
  clearTick();
  clearCountdown();
  state.direction = "right";
  state.directionQueue = [];
  state.score = 0;
  state.running = false;
  state.hasStarted = false;
  state.gameOver = false;
  state.bufferedDirections = [];
  state.collectionPulses = [];
  installFreshBoard();
  updateHud();
  requestRender();
};

const endGame = () => {
  clearTick();
  clearCountdown();
  state.directionQueue = [];
  state.running = false;
  state.gameOver = true;
  saveHighScores();
  updateHud();
  requestRender();
};

const tick = () => {
  if (!state.running) return;
  const previousScore = state.score;
  const previousApples = state.apples.slice();
  step(state.engineState);
  syncEngineState();
  if (state.score > previousScore) {
    const eatenApple = previousApples.find(
      (apple) => !state.apples.some((candidate) => candidate.x === apple.x && candidate.y === apple.y)
    );
    updateHighScore();
    if (eatenApple) {
      state.collectionPulses.push({ x: eatenApple.x, y: eatenApple.y, startedAt: performance.now() });
    }
  }
  if (state.gameOver) {
    endGame();
    return;
  }
  updateHud();
  requestRender();
  state.tickTimer = setTimeout(tick, SNAKE_TICK_MS);
};

const finishCountdown = () => {
  clearCountdown();
  if (!isSnakeWindowVisible() || !isPageActive(document)) {
    updateHud();
    requestRender();
    return;
  }
  state.running = true;
  state.hasStarted = true;
  updateHud();
  startNoiseAnimation();
  focusBoard();
  clearTick();
  state.tickTimer = setTimeout(tick, SNAKE_TICK_MS);
  requestRender();
};

const startGame = () => {
  if (state.loading) return;
  if (state.gameOver) resetGame();
  if (state.running || state.countdownTimer) return;
  state.hasStarted = true;
  const pendingDirections = state.bufferedDirections;
  state.bufferedDirections = [];
  pendingDirections.forEach(recordDirection);
  state.countdownStartedAt = performance.now();
  state.countdownDuration = SNAKE_COUNTDOWN_MS;
  state.countdownTimer = window.setTimeout(finishCountdown, SNAKE_COUNTDOWN_MS);
  updateHud();
  startNoiseAnimation();
  focusBoard();
  clearTick();
  requestRender();
};

const pauseGame = () => {
  if (!state.running && !state.countdownTimer) return;
  state.running = false;
  clearCountdown();
  clearTick();
  updateHud();
  requestRender();
};

const toggleGame = () => {
  if (state.running || state.countdownTimer) {
    pauseGame();
    return;
  }
  startGame();
};

// Clicking outside the window pauses the game; the click that did so must
// not also activate whichever control it landed on a moment later.
const shouldSuppressPointerClick = () => {
  const suppress = performance.now() < pointerPauseSuppressUntil;
  if (suppress) pointerPauseSuppressUntil = 0;
  return suppress;
};

const handleKeydown = (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.matches("input, textarea, select")) return false;
  if (state.loading) {
    if (KEY_DIRECTIONS[event.key] || event.key === " " || event.key === "Enter") event.preventDefault();
    return true;
  }
  if (state.gameOver) {
    if (event.key === "Enter") {
      event.preventDefault();
      resetGame();
      focusBoard();
      return true;
    }
    if (KEY_DIRECTIONS[event.key] || event.key === " ") event.preventDefault();
    return true;
  }
  const direction = KEY_DIRECTIONS[event.key];
  if (direction) {
    event.preventDefault();
    setDirection(direction);
    if (!state.running && !state.countdownTimer) startGame();
    return true;
  }
  const beginsGame =
    !state.hasStarted &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !["Shift", "Meta", "Control", "Alt"].includes(event.key);
  if (beginsGame) {
    event.preventDefault();
    startGame();
    return true;
  }
  if (event.key === " ") {
    event.preventDefault();
    toggleGame();
    return true;
  }
  return false;
};

const handleActivityChange = () => {
  if (!isSnakeWindowVisible()) {
    stopNoiseAnimation();
    return;
  }
  if (!isPageActive(document)) {
    stopNoiseAnimation();
    if (state.running || state.countdownTimer) pauseGame();
    else requestRender();
    return;
  }
  requestRender();
};

const handleReducedMotionChange = () => {
  clearNoiseCanvas(ui.noiseCanvas);
  if (prefersReducedMotion()) stopNoiseAnimation();
  requestRender();
};

/** A read-only view of the game for debugging and UI tests. */
const snapshot = () => ({
  gridSize: state.gridSize,
  snake: state.snake.map(({ x, y }) => ({ x, y })),
  apples: state.apples.map(({ x, y }) => ({ x, y })),
  direction: state.direction,
  directionQueue: state.directionQueue.slice(),
  score: state.score,
  highScore: getHighScore(),
  running: state.running,
  hasStarted: state.hasStarted,
  gameOver: state.gameOver,
  loading: state.loading,
  countingDown: Boolean(state.countdownTimer),
});

// Markup -------------------------------------------------------------------

const COLOR_NAMES = Object.keys(COLOR_THEMES);

const colorButtons = (attribute, noun, selectedColor) =>
  COLOR_NAMES.map((color) => {
    const selected = color === selectedColor;
    const label = `${color[0].toUpperCase()}${color.slice(1)} ${noun}`;
    return `<button class="snake-color-button${selected ? " is-selected" : ""}" type="button" ${attribute}="${color}" aria-label="${label}"${selected ? ' aria-pressed="true"' : ""}><span class="snake-color-swatch" aria-hidden="true"></span></button>`;
  }).join("");

const renderBody = () => `
  <div class="snake-app" aria-label="Snake game">
    <div class="snake-readouts">
      <span id="snake-status">Ready</span>
      <span>Score <span id="snake-score">0</span></span>
      <span>High <span id="snake-high-score">0</span></span>
    </div>
    <div class="snake-display">
      <canvas class="snake-screen" id="snake-canvas" width="320" height="320" tabindex="0" aria-label="Snake game board"></canvas>
      <canvas class="snake-noise-canvas" id="snake-noise-canvas" aria-hidden="true"></canvas>
      <div class="snake-loading-panel" id="snake-loading-panel" aria-hidden="true">
        <div class="snake-loading-title">Loading Snake</div>
        <div class="snake-loading-meter" role="progressbar" aria-label="Snake asset loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="snake-loading-meter-fill" id="snake-loading-meter-fill"></div>
        </div>
        <div class="snake-loading-status">
          <span>Initializing display</span>
          <span id="snake-loading-percent">0%</span>
        </div>
      </div>
    </div>
    <div class="snake-panel">
      <div class="snake-options">
        <div class="snake-panel-section snake-setup-section">
          <div class="snake-actions">
            <button type="button" id="snake-start">Start</button>
            <button type="button" id="snake-reset">Reset</button>
            <button class="snake-help-button" type="button" id="snake-help" aria-label="Snake rules and keybinds">?</button>
          </div>
        </div>
        <div class="snake-panel-section">
          <span class="snake-section-label">Customize</span>
          <div class="snake-setting-control snake-size-control" role="group" aria-label="Snake board size">
            <span class="snake-section-label">Board</span>
            ${BOARD_SIZES.map(
              (size) =>
                `<button type="button" data-snake-board-size="${size}" aria-label="${size} by ${size} board"${size === DEFAULT_GRID_SIZE ? ' class="is-selected" aria-pressed="true"' : ""}>${size}</button>`
            ).join("")}
          </div>
          <div class="snake-setting-control snake-color-control" role="group" aria-label="Snake color">
            <span class="snake-section-label">Snake</span>
            ${colorButtons("data-snake-color", "snake", "green")}
          </div>
          <div class="snake-setting-control snake-color-control" role="group" aria-label="Apple color">
            <span class="snake-section-label">Apple</span>
            ${colorButtons("data-snake-apple-color", "apple", "red")}
          </div>
        </div>
        <div class="snake-panel-section snake-control-section">
          <div class="snake-pad" aria-label="Direction controls">
            <span class="snake-pad-spacer" aria-hidden="true"></span>
            <button type="button" data-snake-direction="up" aria-label="Up"></button>
            <span class="snake-pad-spacer" aria-hidden="true"></span>
            <button type="button" data-snake-direction="left" aria-label="Left"></button>
            <span class="snake-pad-spacer" aria-hidden="true"></span>
            <button type="button" data-snake-direction="right" aria-label="Right"></button>
            <span class="snake-pad-spacer" aria-hidden="true"></span>
            <button type="button" data-snake-direction="down" aria-label="Down"></button>
            <span class="snake-pad-spacer" aria-hidden="true"></span>
          </div>
        </div>
      </div>
    </div>
  </div>`;

const renderRules = () => `
  <div class="snake-rules-panel">
    <div class="snake-rules-title">Snake Controls</div>
    <section class="snake-rules-section" aria-labelledby="snake-keybinds-heading">
      <div class="snake-rules-section-title" id="snake-keybinds-heading">Keybinds</div>
      <dl class="snake-keybind-list">
        <dt><kbd>Arrow keys</kbd></dt>
        <dd>Turn the snake.</dd>
        <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt>
        <dd>Turn the snake.</dd>
        <dt><kbd>Space</kbd></dt>
        <dd>Pause or resume.</dd>
        <dt><kbd>Enter</kbd></dt>
        <dd>Restart after signal loss.</dd>
        <dt><kbd>Any key</kbd></dt>
        <dd>Begin from the ready screen.</dd>
      </dl>
    </section>
    <section class="snake-rules-section" aria-labelledby="snake-rules-heading">
      <div class="snake-rules-section-title" id="snake-rules-heading">Rules</div>
      <ol class="snake-rules-list">
        <li>Eat radar pings to score and grow.</li>
        <li>Avoid walls and your own body.</li>
        <li>Moving into the current tail is allowed when you are not eating.</li>
        <li>Clicking outside the Snake window pauses the game.</li>
      </ol>
    </section>
  </div>`;

// Mount --------------------------------------------------------------------

const bindPanelButton = (button, handler) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.loading) return;
    if (shouldSuppressPointerClick()) return;
    handler(button);
  });
};

const mount = ({ window: win, body }) => {
  ui.window = win;
  ui.loadingPanel = body.querySelector("#snake-loading-panel");
  ui.loadingMeter = body.querySelector(".snake-loading-meter");
  ui.loadingMeterFill = body.querySelector("#snake-loading-meter-fill");
  ui.loadingPercent = body.querySelector("#snake-loading-percent");
  ui.canvas = body.querySelector("#snake-canvas");
  ui.noiseCanvas = body.querySelector("#snake-noise-canvas");
  ui.status = body.querySelector("#snake-status");
  ui.score = body.querySelector("#snake-score");
  ui.highScore = body.querySelector("#snake-high-score");
  ui.start = body.querySelector("#snake-start");
  ui.boardSizeButtons = [...body.querySelectorAll("[data-snake-board-size]")];
  ui.colorButtons = [...body.querySelectorAll("[data-snake-color]")];
  ui.appleColorButtons = [...body.querySelectorAll("[data-snake-apple-color]")];

  bindPanelButton(ui.start, toggleGame);
  bindPanelButton(body.querySelector("#snake-reset"), () => {
    resetGame();
    focusBoard();
  });
  body.querySelector("#snake-help").addEventListener("click", (event) => {
    event.preventDefault();
    if (shouldSuppressPointerClick()) return;
    openWindow(RULES_ID);
  });
  ui.boardSizeButtons.forEach((button) =>
    bindPanelButton(button, () => {
      const selectedSize = Number(button.dataset.snakeBoardSize);
      state.gridSize = BOARD_SIZES.includes(selectedSize) ? selectedSize : DEFAULT_GRID_SIZE;
      saveSettings();
      resetGame();
      focusBoard();
    })
  );
  ui.colorButtons.forEach((button) =>
    bindPanelButton(button, () => {
      if (!COLOR_THEMES[button.dataset.snakeColor]) return;
      state.color = button.dataset.snakeColor;
      saveSettings();
      updateHud();
      requestRender();
      focusBoard();
    })
  );
  ui.appleColorButtons.forEach((button) =>
    bindPanelButton(button, () => {
      if (!COLOR_THEMES[button.dataset.snakeAppleColor]) return;
      state.appleColor = button.dataset.snakeAppleColor;
      saveSettings();
      updateHud();
      requestRender();
      focusBoard();
    })
  );
  body.querySelectorAll("[data-snake-direction]").forEach((button) =>
    bindPanelButton(button, () => {
      setDirection(button.getAttribute("data-snake-direction"));
      if (!state.running && !state.countdownTimer) startGame();
    })
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if ((!state.running && !state.countdownTimer) || !isSnakeWindowVisible()) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest(`[data-app-window="${APP_ID}"]`)) return;
      pauseGame();
      pointerPauseSuppressUntil = performance.now() + POINTER_PAUSE_SUPPRESSION_MS;
    },
    true
  );
  document.addEventListener("visibilitychange", handleActivityChange);
  window.addEventListener("blur", handleActivityChange);
  window.addEventListener("focus", handleActivityChange);
  reducedMotionQuery?.addEventListener?.("change", handleReducedMotionChange);

  state.highScores = loadHighScores();
  const savedSettings = loadSettings();
  if (savedSettings) {
    state.gridSize = savedSettings.gridSize;
    state.color = savedSettings.color;
    state.appleColor = savedSettings.appleColor;
  }
  resetGame();
  window.win98SiteKitSnake = Object.freeze({ snapshot });
};

export default {
  id: APP_ID,
  title: "Snake",
  icon: "assets/snake/snake-logo.png",
  styles: ["apps/snake/snake.css"],
  window: {
    className: "snake-window",
    controls: ["close"],
  },
  render: renderBody,
  mount,
  onOpen: () => startLoadingSequence(),
  onClose: () => {
    clearLoadingSequence();
    pauseGame();
    stopNoiseAnimation();
  },
  onResize: () => {
    if (isSnakeWindowVisible()) requestRender();
  },
  onKeydown: (event) => handleKeydown(event),
  windows: [
    {
      id: RULES_ID,
      title: "Snake Rules",
      window: { className: "snake-rules-window", controls: ["close"] },
      render: renderRules,
    },
  ],
};
