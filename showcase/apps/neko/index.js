// Neko: a windowless app. The desktop icon is a bed with a sleeping cat;
// clicking it wakes the cat, which chases the pointer, leaves footprints,
// scratches the viewport edges and naps when the pointer rests. Clicking
// again sends it back to bed. Right-click (or Shift+F10) on either launcher
// opens a one-item context menu whose /nekostream command, after a System
// Alert confirmation, runs forty cats along the taskbar.
// Sprites and the original behaviour come from github.com/crgimenes/neko
// (BSD-2-Clause, see assets/neko/LICENSE).

import {
  bringToFront,
  clamp,
  getWindow,
  isWindowOpen,
  onViewportResize,
  prefersReducedMotion,
  reducedMotionQuery,
  setFocusReturn,
  showAlert,
} from "../../kit/index.js";
import * as motion from "./motion.js";

const SPRITE_BASE = "assets/neko/sprites";
const BED_ICON = "assets/neko/neko-bed-empty-icon.png";
const CREDIT_ICON = "assets/neko/neko-credit-icon.png";
const CONTEXT_MENU_ID = "neko-context-menu";
const STREAM_COMMAND_ID = "neko-stream-command";
const STREAM_LAYER_ID = "neko-stream-layer";
const STREAM_ALERT_ID = "neko-stream-alert";
const STREAM_ALERT_PROMPT = "Trigger /nekostream?";

const SPRITES = Object.freeze(
  Object.fromEntries(motion.SPRITE_NAMES.map((name) => [name, `${SPRITE_BASE}/${name}.png`]))
);
const FOOTPRINT_SPRITES = Object.freeze(
  Object.fromEntries(motion.DIRECTIONS.map((direction) => [direction, `${SPRITE_BASE}/fp_${direction}.png`]))
);
const TASKBAR_WAKE_ICON = SPRITES.awake;
const TASKBAR_SLEEP_ICON = SPRITES.sleep1;

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const taskbarElement = () => document.querySelector(".taskbar");
const launchers = () => Array.from(document.querySelectorAll('[data-app="neko"]'));

// ------------------------------------------------------------- sprite preload

let runAssetsPreloadStarted = false;
let runAssetsLoaded = false;
let runAssetsPreloadPromise = null;
const preloadedImages = [];

const preloadRunAssets = () => {
  if (runAssetsPreloadStarted) return runAssetsPreloadPromise;
  runAssetsPreloadStarted = true;
  const urls = new Set([...Object.values(SPRITES), ...Object.values(FOOTPRINT_SPRITES)]);
  runAssetsPreloadPromise = Promise.all(
    Array.from(
      urls,
      (src) =>
        new Promise((resolve) => {
          const image = new Image();
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          image.decoding = "async";
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          image.src = src;
          if (image.complete) finish();
          preloadedImages.push(image);
        })
    )
  ).then(() => {
    runAssetsLoaded = true;
  });
  return runAssetsPreloadPromise;
};

// ------------------------------------------------------------ taskbar stream

let streamLayer = null;
const streamCats = new Map();
const streamSpawnTimerIds = new Set();
let streamAnimationFrameId = null;
let streamLastFrameTimestamp = 0;
let streamGeneration = 0;

const syncStreamLane = () => {
  if (!streamLayer) return;
  const bounds = taskbarElement()?.getBoundingClientRect();
  const taskbarTop = bounds && bounds.height > 0 ? bounds.top : null;
  streamLayer.style.setProperty("--neko-stream-lane-y", `${motion.streamLaneY(taskbarTop, window.innerHeight)}px`);
};

const setStreamCatSprite = (cat, spriteName) => {
  const resolved = SPRITES[spriteName] ? spriteName : "awake";
  const source = SPRITES[resolved];
  cat.element.dataset.sprite = resolved;
  cat.element.style.setProperty("--neko-stream-pose-offset-y", `${motion.streamPoseOffsetY(resolved)}px`);
  if (cat.element.getAttribute("src") !== source) cat.element.src = source;
};

const setStreamCatDirection = (cat, direction) => {
  cat.direction = direction;
  cat.element.dataset.direction = direction < 0 ? "left" : "right";
};

const setStreamCatSpeed = (cat, speedMultiplier) => {
  cat.speedMultiplier = speedMultiplier;
  cat.element.dataset.speedMultiplier = speedMultiplier.toFixed(3);
};

const setStreamCatMode = (cat, mode) => {
  cat.mode = mode;
  cat.element.dataset.mode = mode;
};

const renderStreamCat = (cat) => {
  cat.element.style.left = `${cat.x.toFixed(2)}px`;
};

const removeStreamCat = (cat) => {
  cat.element.remove();
  streamCats.delete(cat.id);
};

const runSpriteFor = (direction, frameIndex) => motion.RUN_SPRITES[direction < 0 ? "left" : "right"][frameIndex];

const startStreamCatAction = (cat, timestamp) => {
  cat.actionStartedAt = timestamp;
  cat.actionCount += 1;
  cat.element.dataset.actionCount = String(cat.actionCount);
  setStreamCatMode(cat, cat.action.name);
  setStreamCatSprite(cat, motion.streamActionSpriteName(cat.action, 0));
};

const completeStreamCatAction = (cat) => {
  cat.actionCompleted = true;
  cat.element.dataset.actionCompleted = "true";
  const nextDirection = cat.postActionDirection ?? (motion.sampleRoll() < 0.5 ? -1 : 1);
  const nextSpeedMultiplier =
    cat.postActionSpeedMultiplier ??
    motion.sampleRange(motion.STREAM_MIN_SPEED_MULTIPLIER, motion.STREAM_MAX_SPEED_MULTIPLIER);
  setStreamCatDirection(cat, nextDirection);
  setStreamCatSpeed(cat, nextSpeedMultiplier);
  cat.runFrameIndex = 0;
  cat.runFrameElapsedMs = 0;
  setStreamCatMode(cat, "running");
  setStreamCatSprite(cat, runSpriteFor(cat.direction, 0));
};

const updateStreamCatAction = (cat, timestamp) => {
  const elapsedMs = Math.max(0, timestamp - cat.actionStartedAt);
  if (elapsedMs >= cat.actionDurationMs) {
    completeStreamCatAction(cat);
    return;
  }
  setStreamCatSprite(cat, motion.streamActionSpriteName(cat.action, elapsedMs));
};

const updateRunningStreamCat = (cat, deltaMs, timestamp, viewportWidth) => {
  if (motion.shouldStartStreamAction(cat, viewportWidth)) {
    startStreamCatAction(cat, timestamp);
    return;
  }
  cat.x += motion.streamStepX(cat.direction, cat.speedMultiplier, deltaMs);
  const frame = motion.advanceRunFrame(cat.runFrameIndex, cat.runFrameElapsedMs, deltaMs);
  cat.runFrameIndex = frame.runFrameIndex;
  cat.runFrameElapsedMs = frame.runFrameElapsedMs;
  if (frame.changed) setStreamCatSprite(cat, runSpriteFor(cat.direction, cat.runFrameIndex));
  if (motion.isOutsideViewport(cat.x, viewportWidth)) {
    removeStreamCat(cat);
    return;
  }
  renderStreamCat(cat);
};

const animateStream = (timestamp) => {
  if (!streamCats.size) {
    streamAnimationFrameId = null;
    streamLastFrameTimestamp = 0;
    return;
  }
  if (!streamLastFrameTimestamp) streamLastFrameTimestamp = timestamp;
  const deltaMs = motion.clampFrameDelta(timestamp - streamLastFrameTimestamp);
  streamLastFrameTimestamp = timestamp;
  const viewportWidth = window.innerWidth;
  streamCats.forEach((cat) => {
    if (motion.isOutsideViewport(cat.x, viewportWidth)) {
      removeStreamCat(cat);
      return;
    }
    if (cat.mode === "running") updateRunningStreamCat(cat, deltaMs, timestamp, viewportWidth);
    else updateStreamCatAction(cat, timestamp);
  });
  if (!streamCats.size) {
    streamAnimationFrameId = null;
    streamLastFrameTimestamp = 0;
    return;
  }
  streamAnimationFrameId = window.requestAnimationFrame(animateStream);
};

const ensureStreamAnimation = () => {
  if (streamAnimationFrameId !== null || !streamCats.size) return;
  streamLastFrameTimestamp = 0;
  streamAnimationFrameId = window.requestAnimationFrame(animateStream);
};

const spawnStreamCat = (plan) => {
  if (!streamLayer) return;
  const element = document.createElement("img");
  element.className = "neko-stream-cat";
  element.alt = "";
  element.draggable = false;
  element.setAttribute("aria-hidden", "true");
  element.dataset.nekoStreamCat = String(plan.id);
  element.dataset.entrySide = plan.entrySide;
  element.dataset.action = plan.action?.name || "none";
  element.dataset.actionCount = "0";
  element.dataset.actionCompleted = "false";
  const cat = {
    id: plan.id,
    element,
    x: plan.entrySide === "left" ? -motion.SPRITE_SIZE / 2 : window.innerWidth + motion.SPRITE_SIZE / 2,
    entrySide: plan.entrySide,
    direction: plan.initialDirection,
    speedMultiplier: plan.initialSpeedMultiplier,
    action: plan.action,
    actionTriggerProgress: plan.actionTriggerProgress,
    actionDurationMs: plan.actionDurationMs,
    postActionDirection: plan.postActionDirection,
    postActionSpeedMultiplier: plan.postActionSpeedMultiplier,
    actionStartedAt: null,
    actionCompleted: false,
    actionCount: 0,
    mode: "running",
    runFrameIndex: 0,
    runFrameElapsedMs: 0,
  };
  setStreamCatDirection(cat, plan.initialDirection);
  setStreamCatSpeed(cat, plan.initialSpeedMultiplier);
  setStreamCatMode(cat, "running");
  setStreamCatSprite(cat, runSpriteFor(plan.initialDirection, 0));
  renderStreamCat(cat);
  streamLayer.append(element);
  streamCats.set(cat.id, cat);
  ensureStreamAnimation();
};

const stopStream = () => {
  streamGeneration += 1;
  streamSpawnTimerIds.forEach((timerId) => window.clearTimeout(timerId));
  streamSpawnTimerIds.clear();
  if (streamAnimationFrameId !== null) window.cancelAnimationFrame(streamAnimationFrameId);
  streamAnimationFrameId = null;
  streamLastFrameTimestamp = 0;
  streamCats.clear();
  streamLayer?.replaceChildren();
};

/** Replaces any running wave with a fresh forty-cat plan once sprites are loaded. */
const startStream = (plan = motion.createStreamPlan()) => {
  stopStream();
  if (!streamLayer) return;
  const generation = streamGeneration;
  syncStreamLane();
  const scheduleSpawns = () => {
    if (generation !== streamGeneration) return;
    plan.forEach((catPlan) => {
      const timerId = window.setTimeout(() => {
        streamSpawnTimerIds.delete(timerId);
        if (generation !== streamGeneration) return;
        spawnStreamCat(catPlan);
      }, catPlan.spawnDelayMs);
      streamSpawnTimerIds.add(timerId);
    });
  };
  if (runAssetsLoaded) {
    scheduleSpawns();
    return;
  }
  void preloadRunAssets().then(scheduleSpawns);
};

// -------------------------------------------------------- stream confirmation

let alertIconFrame = 0;
let alertIconTimerId = null;

const alertIcon = () => getWindow(STREAM_ALERT_ID)?.querySelector(".system-alert-message img") ?? null;

const setAlertIconFrame = () => {
  const icon = alertIcon();
  if (!icon) return;
  const sprite = SPRITES[motion.sleepSpriteName(alertIconFrame)];
  if (icon.getAttribute("src") !== sprite) icon.src = sprite;
};

const stopAlertIconAnimation = () => {
  if (alertIconTimerId !== null) window.clearInterval(alertIconTimerId);
  alertIconTimerId = null;
};

/** Breathes the alert's sleeping cat every 850ms; reduced motion keeps the first frame. */
const startAlertIconAnimation = () => {
  stopAlertIconAnimation();
  alertIconFrame = 0;
  setAlertIconFrame();
  if (prefersReducedMotion()) return;
  alertIconTimerId = window.setInterval(() => {
    if (!isWindowOpen(STREAM_ALERT_ID)) {
      stopAlertIconAnimation();
      return;
    }
    alertIconFrame += 1;
    setAlertIconFrame();
  }, motion.SLEEP_FRAME_INTERVAL_MS);
};

const handleAlertMotionPreferenceChange = () => {
  if (!isWindowOpen(STREAM_ALERT_ID)) return;
  if (prefersReducedMotion()) {
    stopAlertIconAnimation();
    alertIconFrame = 0;
    setAlertIconFrame();
    return;
  }
  startAlertIconAnimation();
};

/** Shows the confirmation and starts the stream only on the first Yes. */
const confirmStream = (origin) => {
  if (isWindowOpen(STREAM_ALERT_ID)) {
    const open = getWindow(STREAM_ALERT_ID);
    bringToFront(open);
    open.querySelector('[data-alert-button="yes"]')?.focus({ preventScroll: true });
    return;
  }
  const response = showAlert({
    id: STREAM_ALERT_ID,
    title: "System Alert",
    icon: SPRITES.sleep1,
    body: `<p>${STREAM_ALERT_PROMPT}</p>`,
    buttons: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    className: "neko-stream-alert-window",
  });
  const win = getWindow(STREAM_ALERT_ID);
  if (origin?.isConnected) setFocusReturn(win, origin);
  startAlertIconAnimation();
  window.requestAnimationFrame(() => {
    if (isWindowOpen(STREAM_ALERT_ID)) {
      win.querySelector('[data-alert-button="yes"]')?.focus({ preventScroll: true });
    }
  });
  void response.then((pressed) => {
    stopAlertIconAnimation();
    if (pressed === "yes") startStream();
  });
};

// --------------------------------------------------------------- context menu

let contextMenu = null;
let streamCommand = null;
let contextMenuOrigin = null;

const closeContextMenu = ({ restoreFocus = false } = {}) => {
  if (!contextMenu) return;
  const origin = contextMenuOrigin;
  contextMenu.hidden = true;
  contextMenu.style.removeProperty("left");
  contextMenu.style.removeProperty("top");
  contextMenu.style.removeProperty("visibility");
  launchers().forEach((launcher) => launcher.setAttribute("aria-expanded", "false"));
  contextMenuOrigin = null;
  if (restoreFocus && origin?.isConnected) origin.focus({ preventScroll: true });
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusAdjacentLauncherControl = (moveBackward) => {
  const origin = contextMenuOrigin;
  if (!origin) {
    closeContextMenu();
    return;
  }
  const controls = Array.from(origin.parentElement?.querySelectorAll(FOCUSABLE) || []).filter(
    (control) => control.getClientRects().length > 0
  );
  const originIndex = controls.indexOf(origin);
  const target = controls[originIndex + (moveBackward ? -1 : 1)] || origin;
  closeContextMenu();
  target.focus({ preventScroll: true });
};

const openContextMenu = (launcher, clientX, clientY) => {
  if (!contextMenu || !streamCommand) return;
  void preloadRunAssets();
  closeContextMenu();
  contextMenuOrigin = launcher;
  launcher.setAttribute("aria-expanded", "true");
  contextMenu.hidden = false;
  contextMenu.style.visibility = "hidden";
  contextMenu.style.left = "0px";
  contextMenu.style.top = "0px";
  const menuBounds = contextMenu.getBoundingClientRect();
  const launcherBounds = launcher.getBoundingClientRect();
  const taskbarBounds = taskbarElement()?.getBoundingClientRect();
  const position = motion.contextMenuPosition({
    requestedLeft: Number.isFinite(clientX) ? clientX : launcherBounds.left,
    requestedTop: Number.isFinite(clientY) ? clientY : launcherBounds.bottom,
    menuWidth: menuBounds.width,
    menuHeight: menuBounds.height,
    viewport: viewport(),
    taskbarTop: taskbarBounds?.top ?? null,
  });
  contextMenu.style.left = `${position.left}px`;
  contextMenu.style.top = `${position.top}px`;
  contextMenu.style.visibility = "visible";
  streamCommand.focus({ preventScroll: true });
};

const bindLauncherContextMenu = (launcher) => {
  if (launcher.dataset.nekoMenuBound === "true") return;
  launcher.dataset.nekoMenuBound = "true";
  launcher.setAttribute("aria-haspopup", "menu");
  launcher.setAttribute("aria-controls", CONTEXT_MENU_ID);
  launcher.setAttribute("aria-expanded", "false");
  launcher.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(launcher, event.clientX, event.clientY);
  });
  launcher.addEventListener("keydown", (event) => {
    const opensContextMenu = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
    if (!opensContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = launcher.getBoundingClientRect();
    openContextMenu(launcher, bounds.left, bounds.bottom);
  });
};

const createContextMenu = () => {
  contextMenu = document.createElement("div");
  contextMenu.className = "neko-context-menu";
  contextMenu.id = CONTEXT_MENU_ID;
  contextMenu.setAttribute("role", "menu");
  contextMenu.setAttribute("aria-label", "Neko commands");
  contextMenu.hidden = true;
  streamCommand = document.createElement("button");
  streamCommand.className = "neko-context-menu__item";
  streamCommand.id = STREAM_COMMAND_ID;
  streamCommand.type = "button";
  streamCommand.setAttribute("role", "menuitem");
  streamCommand.textContent = "/nekostream";
  contextMenu.append(streamCommand);
  document.body.append(contextMenu);

  streamCommand.addEventListener("click", () => {
    const origin = contextMenuOrigin;
    closeContextMenu({ restoreFocus: true });
    confirmStream(origin);
  });
  contextMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      focusAdjacentLauncherControl(event.shiftKey);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      streamCommand.focus({ preventScroll: true });
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (contextMenu.hidden || contextMenu.contains(event.target)) return;
    closeContextMenu();
  });
  document.addEventListener("contextmenu", (event) => {
    if (contextMenu.hidden || event.target.closest?.('[data-app="neko"]')) return;
    closeContextMenu();
  });
  window.addEventListener("scroll", () => closeContextMenu({ restoreFocus: true }), true);
  window.addEventListener("blur", () => closeContextMenu());
};

// ------------------------------------------------------------- desktop cat

let state = "sleeping";
let cat = null;
let animationFrameId = null;
let lastFrameTimestamp = 0;
let frameCount = 0;
let sleepTimerId = null;
let sleepFrame = 0;
let wakeTimerId = null;
let posX = 32;
let posY = 32;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let mouseOutsideWindow = false;
let scratchEdge = null;
let scratchTargetX = null;
let scratchTargetY = null;
let idleAction = null;
let idleActionFrame = 0;
let idleActionCooldownFrames = 0;
let idleStartedAt = 0;
let playedIdleActionForCurrentIdle = false;
let lastMouseMoveAt = performance.now();
let edgeScratchStartedAt = 0;
let isNapping = false;
let napFrame = 0;
let returnX = 32;
let returnY = 32;
let footprints = [];
let lastFootprintX = null;
let lastFootprintY = null;
let nextFootprintSide = 1;

const setIconAwake = (isAwake) => {
  document.querySelectorAll("[data-neko-icon]").forEach((icon) => icon.classList.toggle("is-awake", isAwake));
};

/** `action` is what a click would do next: "wake" shows the awake cat, "sleep" the sleeping one. */
const setTaskbarActionIcon = (action) => {
  const shouldSleep = action === "sleep";
  const iconSrc = shouldSleep ? TASKBAR_SLEEP_ICON : TASKBAR_WAKE_ICON;
  document.querySelectorAll("[data-neko-taskbar-icon]").forEach((image) => {
    if (image.getAttribute("src") !== iconSrc) image.src = iconSrc;
    image.classList.toggle("is-neko-active", shouldSleep);
    const button = image.closest(".taskbar-icon");
    if (button?.hasAttribute("aria-pressed")) {
      button.classList.toggle("is-open", shouldSleep);
      button.setAttribute("aria-pressed", String(shouldSleep));
    }
  });
};

const setSleepingIconFrame = (frame) => {
  const sprite = SPRITES[motion.sleepSpriteName(frame)];
  document.querySelectorAll("[data-neko-sleeping-cat]").forEach((image) => {
    if (image.getAttribute("src") !== sprite) image.src = sprite;
  });
};

const startSleepBreathing = () => {
  if (sleepTimerId) return;
  sleepFrame = 0;
  setSleepingIconFrame(sleepFrame);
  sleepTimerId = window.setInterval(() => {
    if (state !== "sleeping") return;
    sleepFrame += 1;
    setSleepingIconFrame(sleepFrame);
  }, motion.SLEEP_FRAME_INTERVAL_MS);
};

const stopSleepBreathing = () => {
  if (!sleepTimerId) return;
  window.clearInterval(sleepTimerId);
  sleepTimerId = null;
};

const setCatSprite = (spriteName) => {
  if (!cat) return;
  const src = SPRITES[spriteName] || SPRITES.awake;
  if (cat.getAttribute("src") !== src) cat.src = src;
};

const renderCat = () => {
  if (!cat) return;
  cat.style.left = `${Math.round(posX)}px`;
  cat.style.top = `${Math.round(posY)}px`;
};

const resetFootprintSpacing = () => {
  lastFootprintX = null;
  lastFootprintY = null;
  nextFootprintSide = 1;
};

const removeFootprint = (footprint) => {
  if (!footprint) return;
  window.clearTimeout(footprint.timerId);
  footprint.element.remove();
  footprints = footprints.filter((item) => item !== footprint);
};

const trimFootprints = () => {
  while (footprints.length > motion.FOOTPRINT_MAX) removeFootprint(footprints[0]);
};

const createFootprint = (x, y, direction, pawSide) => {
  const src = FOOTPRINT_SPRITES[direction];
  if (!src) return;
  const placement = motion.footprintPlacement(x, y, direction);
  const element = document.createElement("img");
  element.className = `desktop-neko-footprint desktop-neko-footprint--${pawSide < 0 ? "left" : "right"}`;
  element.src = src;
  element.alt = "";
  element.draggable = false;
  element.setAttribute("aria-hidden", "true");
  element.style.left = `${placement.left}px`;
  element.style.top = `${placement.top}px`;
  const entry = { element, timerId: null };
  entry.timerId = window.setTimeout(() => removeFootprint(entry), motion.FOOTPRINT_TTL_MS);
  footprints.push(entry);
  document.body.append(element);
  trimFootprints();
};

const createFootprintPair = (x, y, direction, moveX, moveY) => {
  for (const paw of motion.footprintPairPositions({ x, y, moveX, moveY, side: nextFootprintSide })) {
    createFootprint(paw.x, paw.y, direction, paw.side);
  }
  nextFootprintSide *= -1;
};

const maybeCreateFootprints = (x, y, direction, moveX, moveY) => {
  if (!motion.shouldDropFootprint(lastFootprintX, lastFootprintY, x, y)) return;
  lastFootprintX = x;
  lastFootprintY = y;
  createFootprintPair(x, y, direction, moveX, moveY);
};

const setScratchTarget = (edge, clientX, clientY) => {
  const target = motion.clampTargetToViewport(clientX, clientY, viewport());
  const anchor = motion.scratchAnchor(edge, target.x, target.y, viewport());
  const changed =
    scratchEdge !== edge ||
    !Number.isFinite(scratchTargetX) ||
    !Number.isFinite(scratchTargetY) ||
    Math.abs(scratchTargetX - anchor.x) > 1 ||
    Math.abs(scratchTargetY - anchor.y) > 1;
  mouseOutsideWindow = true;
  scratchEdge = edge;
  scratchTargetX = anchor.x;
  scratchTargetY = anchor.y;
  mouseX = anchor.x;
  mouseY = anchor.y;
  if (changed) edgeScratchStartedAt = 0;
};

const updatePointerTarget = (event) => {
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return;
  if (Math.abs(event.clientX - mouseX) > 1 || Math.abs(event.clientY - mouseY) > 1) {
    lastMouseMoveAt = performance.now();
    idleStartedAt = 0;
    playedIdleActionForCurrentIdle = false;
    isNapping = false;
    napFrame = 0;
  }
  const edge = motion.pointerViewportEdge(event.clientX, event.clientY, viewport());
  if (edge) {
    setScratchTarget(edge, event.clientX, event.clientY);
    return;
  }
  mouseOutsideWindow = false;
  scratchEdge = null;
  scratchTargetX = null;
  scratchTargetY = null;
  edgeScratchStartedAt = 0;
  mouseX = event.clientX;
  mouseY = event.clientY;
};

const handlePointerExit = (event) => {
  if (!["waking", "chasing"].includes(state)) return;
  if (event.relatedTarget || event.toElement) return;
  const fallbackX = clamp(mouseX, 0, window.innerWidth);
  const fallbackY = clamp(mouseY, 0, window.innerHeight);
  const clientX = Number.isFinite(event.clientX) ? event.clientX : fallbackX;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : fallbackY;
  setScratchTarget(motion.pointerExitEdge(clientX, clientY, viewport()), clientX, clientY);
};

const getHomePosition = () => {
  const sleepingCat = document.querySelector("[data-neko-sleeping-cat]");
  const sleepingRect = sleepingCat?.getBoundingClientRect();
  if (sleepingRect?.width && sleepingRect?.height) return motion.homePositionFromRect(sleepingRect, viewport());
  const icon = document.querySelector("[data-neko-icon]");
  return motion.homePositionFromRect(icon?.getBoundingClientRect(), viewport());
};

const createCat = () => {
  cat = document.createElement("img");
  cat.className = "desktop-neko-cat";
  cat.src = SPRITES.awake;
  cat.alt = "";
  cat.draggable = false;
  cat.setAttribute("aria-hidden", "true");
  cat.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startManualAction();
  });
  document.body.append(cat);
};

const clearWakeTimer = () => {
  if (!wakeTimerId) return;
  window.clearTimeout(wakeTimerId);
  wakeTimerId = null;
};

const cancelAnimationFrame = () => {
  if (!animationFrameId) return;
  window.cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
};

const clearIdleAction = () => {
  idleAction = null;
  idleActionFrame = 0;
};

const startRandomIdleAction = () => {
  idleAction = motion.IDLE_ACTIONS[Math.floor(Math.random() * motion.IDLE_ACTIONS.length)];
  idleActionFrame = 0;
  playedIdleActionForCurrentIdle = true;
};

const clearActiveInterruptions = () => {
  clearIdleAction();
  mouseOutsideWindow = false;
  scratchEdge = null;
  scratchTargetX = null;
  scratchTargetY = null;
  edgeScratchStartedAt = 0;
  isNapping = false;
  napFrame = 0;
  idleStartedAt = 0;
  playedIdleActionForCurrentIdle = false;
};

/** Clicking the awake cat plays a random action in place. */
const startManualAction = () => {
  if (!cat || state === "sleeping") return;
  if (state === "waking") {
    clearWakeTimer();
    state = "chasing";
  } else if (state === "returning") {
    state = "chasing";
  }
  clearActiveInterruptions();
  idleAction = motion.MANUAL_ACTIONS[Math.floor(Math.random() * motion.MANUAL_ACTIONS.length)];
  idleActionFrame = 0;
  idleActionCooldownFrames = 0;
  idleStartedAt = performance.now();
  playedIdleActionForCurrentIdle = true;
  lastMouseMoveAt = performance.now();
  setTaskbarActionIcon("sleep");
  playIdleAction();
  ensureAnimationFrame();
};

const scratchViewportEdge = (edge) => {
  const sprites = motion.SCRATCH_SPRITES[edge];
  if (!sprites) return false;
  if (Number.isFinite(scratchTargetX) && Number.isFinite(scratchTargetY)) {
    posX = motion.clampCenterX(scratchTargetX, window.innerWidth);
    posY = motion.clampCenterY(scratchTargetY, window.innerHeight);
  }
  setCatSprite(sprites[frameCount % sprites.length]);
  renderCat();
  return true;
};

const putActiveCatToSleep = () => {
  clearIdleAction();
  isNapping = true;
  napFrame = 0;
  setCatSprite("sleep1");
  renderCat();
};

const napActiveCat = () => {
  setCatSprite(motion.napSpriteName(napFrame));
  renderCat();
  napFrame += 1;
};

const playIdleAction = () => {
  if (!idleAction) return false;
  setCatSprite(idleAction.frames[idleActionFrame]);
  renderCat();
  idleActionFrame += 1;
  if (idleActionFrame >= idleAction.frames.length) {
    clearIdleAction();
    idleActionCooldownFrames = motion.IDLE_ACTION_COOLDOWN_FRAMES;
  }
  return true;
};

const maybeStartIdleAction = (timestamp) => {
  if (idleAction) return true;
  if (!idleStartedAt) {
    idleStartedAt = timestamp;
    return false;
  }
  if (!playedIdleActionForCurrentIdle && timestamp - idleStartedAt >= motion.IDLE_ACTION_DELAY_MS) {
    startRandomIdleAction();
    return true;
  }
  if (idleActionCooldownFrames > 0) idleActionCooldownFrames -= 1;
  return false;
};

const setStillPose = () => {
  setCatSprite("yawn1");
  renderCat();
};

const moveTowardTarget = (targetX, targetY, stopDistance) => {
  const step = motion.stepTowardTarget({ x: posX, y: posY, targetX, targetY, stopDistance, viewport: viewport() });
  if (step.arrived) return true;
  const sprites = motion.RUN_SPRITES[step.direction] || motion.RUN_SPRITES.down;
  setCatSprite(sprites[frameCount % sprites.length]);
  posX = step.x;
  posY = step.y;
  maybeCreateFootprints(posX, posY, step.direction, step.moveX, step.moveY);
  renderCat();
  return false;
};

const stepTowardMouse = (timestamp) => {
  frameCount += 1;
  if (isNapping) {
    napActiveCat();
    return;
  }
  if (playIdleAction()) return;
  const distance = Math.sqrt((posX - mouseX) ** 2 + (posY - mouseY) ** 2);
  if (
    mouseOutsideWindow &&
    scratchEdge &&
    motion.isAtScratchEdge({
      edge: scratchEdge,
      x: posX,
      y: posY,
      targetX: scratchTargetX,
      targetY: scratchTargetY,
      viewport: viewport(),
    }) &&
    scratchViewportEdge(scratchEdge)
  ) {
    if (!edgeScratchStartedAt) edgeScratchStartedAt = timestamp;
    else if (timestamp - edgeScratchStartedAt >= motion.EDGE_SCRATCH_SLEEP_MS) putActiveCatToSleep();
    return;
  }
  edgeScratchStartedAt = 0;
  if (distance < motion.SPEED || distance < motion.IDLE_DISTANCE) {
    if (timestamp - lastMouseMoveAt >= motion.MOUSE_STILL_SLEEP_MS) {
      putActiveCatToSleep();
      return;
    }
    if (maybeStartIdleAction(timestamp) && playIdleAction()) return;
    setStillPose();
    return;
  }
  clearIdleAction();
  idleStartedAt = 0;
  playedIdleActionForCurrentIdle = false;
  moveTowardTarget(mouseX, mouseY, motion.SPEED);
};

const stepTowardBed = () => {
  frameCount += 1;
  if (moveTowardTarget(returnX, returnY, motion.RETURN_HOME_DISTANCE)) returnToBed();
};

const animate = (timestamp) => {
  if (!["chasing", "returning"].includes(state)) {
    animationFrameId = null;
    return;
  }
  if (!lastFrameTimestamp) lastFrameTimestamp = timestamp;
  if (timestamp - lastFrameTimestamp >= motion.FRAME_INTERVAL_MS) {
    lastFrameTimestamp = timestamp;
    if (state === "returning") stepTowardBed();
    else stepTowardMouse(timestamp);
  }
  if (!["chasing", "returning"].includes(state)) {
    animationFrameId = null;
    return;
  }
  animationFrameId = window.requestAnimationFrame(animate);
};

const ensureAnimationFrame = () => {
  if (animationFrameId) return;
  lastFrameTimestamp = 0;
  animationFrameId = window.requestAnimationFrame(animate);
};

const startChasing = () => {
  if (state !== "waking") return;
  state = "chasing";
  setTaskbarActionIcon("sleep");
  frameCount = 0;
  lastFrameTimestamp = 0;
  resetFootprintSpacing();
  lastMouseMoveAt = performance.now();
  idleActionCooldownFrames = motion.IDLE_ACTION_COOLDOWN_FRAMES;
  idleStartedAt = 0;
  playedIdleActionForCurrentIdle = false;
  edgeScratchStartedAt = 0;
  isNapping = false;
  napFrame = 0;
  cancelAnimationFrame();
  animationFrameId = window.requestAnimationFrame(animate);
};

const startReturnToBed = () => {
  if (state === "sleeping") return;
  clearWakeTimer();
  clearActiveInterruptions();
  const home = getHomePosition();
  returnX = home.x;
  returnY = home.y;
  state = "returning";
  setTaskbarActionIcon("wake");
  resetFootprintSpacing();
  ensureAnimationFrame();
};

const resumeChasing = () => {
  if (state !== "returning") return;
  clearActiveInterruptions();
  state = "chasing";
  setTaskbarActionIcon("sleep");
  lastMouseMoveAt = performance.now();
  ensureAnimationFrame();
};

const runWakeSequence = (index = 0) => {
  if (state !== "waking") return;
  if (index >= motion.WAKE_SEQUENCE.length) {
    startChasing();
    return;
  }
  const step = motion.WAKE_SEQUENCE[index];
  setCatSprite(step.sprite);
  renderCat();
  clearWakeTimer();
  wakeTimerId = window.setTimeout(() => {
    wakeTimerId = null;
    if (step.waitForRunAssets && !runAssetsLoaded) {
      preloadRunAssets().then(() => {
        if (state !== "waking") return;
        runWakeSequence(index + 1);
      });
      return;
    }
    runWakeSequence(index + 1);
  }, step.duration);
};

const pointerListeners = [
  ["pointermove", updatePointerTarget],
  ["pointerout", handlePointerExit],
  ["pointerleave", handlePointerExit],
  ["mouseout", handlePointerExit],
  ["mouseleave", handlePointerExit],
];

const wake = (event) => {
  if (state !== "sleeping") {
    returnToBed();
    return;
  }
  updatePointerTarget(event);
  const home = getHomePosition();
  posX = home.x;
  posY = home.y;
  stopSleepBreathing();
  setIconAwake(true);
  setTaskbarActionIcon("sleep");
  createCat();
  renderCat();
  preloadRunAssets();
  state = "waking";
  for (const [name, handler] of pointerListeners) document.addEventListener(name, handler);
  runWakeSequence();
};

function returnToBed() {
  if (state === "sleeping") return;
  state = "sleeping";
  clearWakeTimer();
  cancelAnimationFrame();
  clearIdleAction();
  for (const [name, handler] of pointerListeners) document.removeEventListener(name, handler);
  mouseOutsideWindow = false;
  scratchEdge = null;
  scratchTargetX = null;
  scratchTargetY = null;
  edgeScratchStartedAt = 0;
  isNapping = false;
  napFrame = 0;
  idleActionCooldownFrames = 0;
  idleStartedAt = 0;
  playedIdleActionForCurrentIdle = false;
  resetFootprintSpacing();
  cat?.remove();
  cat = null;
  setIconAwake(false);
  setTaskbarActionIcon("wake");
  startSleepBreathing();
}

/** Left click: wake, send home, or (while walking home) chase again. */
const toggle = (event) => {
  if (state === "returning") {
    updatePointerTarget(event);
    resumeChasing();
    return;
  }
  if (state !== "sleeping") {
    startReturnToBed();
    return;
  }
  wake(event);
};

// ----------------------------------------------------------------- launchers

const decorateDesktopIcon = (button) => {
  const image = button.querySelector("img");
  const bed = document.createElement("span");
  bed.className = "neko-icon-image";
  bed.setAttribute("data-neko-icon", "");
  bed.setAttribute("aria-hidden", "true");
  const bedImage = document.createElement("img");
  bedImage.className = "neko-icon-bed";
  bedImage.src = BED_ICON;
  bedImage.alt = "";
  bedImage.draggable = false;
  const sleepingCat = document.createElement("img");
  sleepingCat.className = "neko-icon-sleeping-cat";
  sleepingCat.setAttribute("data-neko-sleeping-cat", "");
  sleepingCat.src = SPRITES[motion.sleepSpriteName(sleepFrame)];
  sleepingCat.alt = "";
  sleepingCat.draggable = false;
  bed.append(bedImage, sleepingCat);
  bed.classList.toggle("is-awake", state !== "sleeping");
  if (image) image.replaceWith(bed);
  else button.prepend(bed);
  button.classList.add("desktop-icon--neko");
};

const decorateDockIcon = (button) => {
  let image = button.querySelector("img");
  if (!image) {
    image = document.createElement("img");
    image.alt = "";
    button.prepend(image);
  }
  image.setAttribute("data-neko-taskbar-icon", "");
  image.src = CREDIT_ICON;
  image.draggable = false;
  setTaskbarActionIcon(state === "sleeping" ? "wake" : "sleep");
};

export default {
  id: "neko",
  title: "Neko",
  icon: CREDIT_ICON,
  styles: ["apps/neko/neko.css"],
  window: false,
  mount() {
    streamLayer = document.createElement("div");
    streamLayer.className = "neko-stream-layer";
    streamLayer.id = STREAM_LAYER_ID;
    streamLayer.setAttribute("aria-hidden", "true");
    document.body.append(streamLayer);
    createContextMenu();
    syncStreamLane();
    startSleepBreathing();
    window.addEventListener("pagehide", stopStream);
    if (typeof reducedMotionQuery?.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", handleAlertMotionPreferenceChange);
    }
    onViewportResize({
      onResize: () => {
        closeContextMenu({ restoreFocus: true });
        syncStreamLane();
      },
    });
  },
  decorateLauncher(button) {
    if (button.classList.contains("desktop-icon")) decorateDesktopIcon(button);
    else decorateDockIcon(button);
    bindLauncherContextMenu(button);
  },
  onLaunch(event) {
    event.preventDefault();
    event.stopPropagation();
    toggle(event);
    return true;
  },
};
