// Custom cursor runtime. The kit ships no cursor artwork: drop a pack into
// assets/cursors/light (and optionally assets/cursors/dark) using the file
// names listed in assets/cursors/README.md, then set `cursor.enabled: true`
// in site.config.js. styles/cursors.css maps those files onto CSS cursor
// tokens; this module owns the light/dark mode, persistence, and the
// animated "working" cursor shown while `observeLoading` predicates are true.

import { readString, writeString } from "./storage.js";

const DARK_MODE_CLASS = "is-cursor-dark-mode";
const READY_CLASS = "is-custom-cursor-ready";
const LOADING_CLASS = "is-custom-cursor-loading";
const LOADING_FRAME_PREFIX = "is-custom-cursor-loading-frame-";
const LOADING_FRAME_COUNT = 9;
const LOADING_FRAME_DELAY_MS = 100;

/** File names a pack folder must contain (see assets/cursors/README.md). */
export const CURSOR_FILES = Object.freeze([
  "normal.cur",
  "select.cur",
  "text.cur",
  "move.cur",
  "help.cur",
  "unavailable.cur",
  "precision.cur",
  "resize-ew.cur",
  "resize-ns.cur",
  "resize-nwse.cur",
  "resize-nesw.cur",
  "busy.ani",
  "working.ani",
]);

let storageKey = "";
let enabled = false;
let currentMode = "light";
let started = false;
let loadingRuntime = null;
const modeListeners = new Set();

const normalizeMode = (mode) => (mode === "dark" ? "dark" : "light");

const applyMode = (mode) => {
  const next = normalizeMode(mode);
  const changed = currentMode !== next;
  currentMode = next;
  document.documentElement.classList.toggle(DARK_MODE_CLASS, next === "dark");
  if (changed) modeListeners.forEach((listener) => listener(next));
  return next;
};

/** Reads config, applies the stored mode and enables the stylesheet rules. */
export const initCursor = (cursorConfig, prefix) => {
  storageKey = `${prefix}.cursorMode`;
  enabled = cursorConfig.enabled;
  currentMode = normalizeMode(readString(storageKey, cursorConfig.defaultMode));
  if (!enabled) return;
  started = true;
  applyMode(currentMode);
  document.documentElement.classList.add(READY_CLASS);
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) applyMode(event.newValue);
  });
};

export const isCursorEnabled = () => enabled;

export const getCursorMode = () => currentMode;

export const setCursorMode = (mode, { persist = true } = {}) => {
  const next = started ? applyMode(mode) : (currentMode = normalizeMode(mode));
  if (persist) writeString(storageKey, next);
  return next;
};

export const onCursorModeChange = (listener) => {
  modeListeners.add(listener);
  listener(currentMode);
  return () => modeListeners.delete(listener);
};

const createLoadingRuntime = () => {
  const sources = new Set();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let frameClass = "";
  let frameTimer = 0;
  let syncFrame = 0;

  const clearFrame = () => {
    if (frameClass) document.documentElement.classList.remove(frameClass);
    frameClass = "";
  };
  const showNextFrame = () => {
    frame = (frame % LOADING_FRAME_COUNT) + 1;
    clearFrame();
    frameClass = `${LOADING_FRAME_PREFIX}${frame}`;
    document.documentElement.classList.add(frameClass);
  };
  const stop = () => {
    window.clearInterval(frameTimer);
    frameTimer = 0;
    frame = 0;
    clearFrame();
  };
  const start = () => {
    if (frameTimer || frameClass) return;
    showNextFrame();
    if (reducedMotion.matches) return;
    frameTimer = window.setInterval(showNextFrame, LOADING_FRAME_DELAY_MS);
  };
  const sync = () => {
    syncFrame = 0;
    const loading = [...sources].some((source) => source());
    document.documentElement.classList.toggle(LOADING_CLASS, loading);
    if (loading && !document.hidden) start();
    else stop();
  };
  const schedule = () => {
    if (!syncFrame) syncFrame = window.requestAnimationFrame(sync);
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : schedule()));
  reducedMotion.addEventListener?.("change", () => {
    stop();
    schedule();
  });
  return Object.freeze({
    addSource: (source) => {
      sources.add(source);
      schedule();
    },
    sync: schedule,
  });
};

/**
 * Shows the animated working cursor while `isLoading()` returns true. Call
 * the returned `sync()` whenever the underlying state changes.
 */
export const observeLoading = (isLoading) => {
  if (typeof isLoading !== "function") throw new TypeError("observeLoading needs a predicate");
  loadingRuntime ||= createLoadingRuntime();
  loadingRuntime.addSource(isLoading);
  return loadingRuntime.sync;
};
