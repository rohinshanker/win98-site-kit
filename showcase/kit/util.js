// Small, dependency-free helpers shared by the kit and by apps.

export const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export const pad2 = (value) => String(value).padStart(2, "0");

/** Clears `timerId` (when set) and schedules `callback` after `delayMs`. */
export const debounceTimer = (timerId, callback, delayMs) => {
  if (timerId) window.clearTimeout(timerId);
  return window.setTimeout(callback, delayMs);
};

/** Runs `callback` after `frameCount` animation frames (immediately for 0). */
export const afterFrames = (frameCount, callback) => {
  if (frameCount <= 0) {
    callback();
    return null;
  }
  return window.requestAnimationFrame(() => afterFrames(frameCount - 1, callback));
};

export const reducedMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export const prefersReducedMotion = () => Boolean(reducedMotionQuery?.matches);

/** Whether the document is visible and, when supported, owns page focus. */
export const isPageActive = (pageDocument = document) =>
  Boolean(
    pageDocument &&
      !pageDocument.hidden &&
      (typeof pageDocument.hasFocus !== "function" || pageDocument.hasFocus())
  );

/** Seconds as `mm:ss`, or the placeholder when there is no time yet. */
export const formatElapsedTime = (seconds, placeholder = "—") => {
  if (!Number.isFinite(seconds)) return placeholder;
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(safeSeconds / 60))}:${pad2(safeSeconds % 60)}`;
};

/** `YYYY-MM-DD` in local time. */
export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const shuffle = (items) => {
  const shuffled = Array.from(items);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const bannerAnimationCleanups = new WeakMap();

/** Restarts a CSS animation class on `element`, leaving no stale listener. */
export const flashBanner = (element, className = "is-showing") => {
  if (!element) return false;
  const previousCleanup = bannerAnimationCleanups.get(element);
  if (previousCleanup) element.removeEventListener("animationend", previousCleanup);
  element.classList.remove(className);
  void element.offsetWidth;
  const cleanup = (event) => {
    if (event.target !== element) return;
    element.classList.remove(className);
    element.removeEventListener("animationend", cleanup);
    if (bannerAnimationCleanups.get(element) === cleanup) {
      bannerAnimationCleanups.delete(element);
    }
  };
  bannerAnimationCleanups.set(element, cleanup);
  element.addEventListener("animationend", cleanup);
  element.classList.add(className);
  return true;
};

/**
 * A cancellable progress scheduler for fake-but-honest loading bars. The
 * caller supplies the progress curve, readiness rule, duration and UI
 * callbacks; the loader only owns timing and cancellation.
 */
export const createProgressLoader = ({
  progressCap,
  isReady = () => true,
  shouldContinue = () => true,
  nextProgress,
  nextDelay,
  onProgress,
  onReady,
  onTimerChange = () => {},
  now = () => performance.now(),
  setTimer = (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer = (timerId) => window.clearTimeout(timerId),
}) => {
  let timerId = null;
  let startedAt = 0;
  let durationMs = 0;
  let progress = 0;
  let running = false;
  let generation = 0;

  const setLoaderTimer = (callback, delayMs) => {
    timerId = setTimer(callback, Math.max(0, delayMs));
    onTimerChange(timerId);
  };

  const clearLoaderTimer = () => {
    if (timerId !== null) clearTimer(timerId);
    timerId = null;
    onTimerChange(null);
  };

  const cancel = () => {
    generation += 1;
    running = false;
    clearLoaderTimer();
  };

  const updateProgress = (value) => {
    progress = clamp(value, 0, progressCap);
    onProgress(progress);
  };

  const tick = (ownedGeneration) => {
    if (!running || ownedGeneration !== generation) return;
    timerId = null;
    onTimerChange(null);
    const continues = shouldContinue();
    if (!running || ownedGeneration !== generation) return;
    if (!continues) {
      cancel();
      return;
    }
    const elapsedMs = Math.max(0, now() - startedAt);
    const ready = elapsedMs >= durationMs && isReady();
    if (!running || ownedGeneration !== generation) return;
    if (ready) {
      running = false;
      progress = 100;
      onProgress(progress);
      if (ownedGeneration !== generation) return;
      onReady();
      return;
    }
    const proposedProgress = nextProgress({ elapsedMs, durationMs, progress, progressCap });
    if (!running || ownedGeneration !== generation) return;
    updateProgress(Math.max(progress, proposedProgress));
    if (!running || ownedGeneration !== generation) return;
    const delayMs = nextDelay({
      elapsedMs,
      durationMs,
      progress,
      progressCap,
      waitingForReady: elapsedMs >= durationMs,
    });
    if (!running || ownedGeneration !== generation) return;
    setLoaderTimer(() => tick(ownedGeneration), delayMs);
  };

  const start = ({ duration, initialDelay = 0, initialProgress = 0 } = {}) => {
    cancel();
    generation += 1;
    const ownedGeneration = generation;
    durationMs = Math.max(0, Number(duration) || 0);
    startedAt = now();
    running = true;
    updateProgress(initialProgress);
    if (!running || ownedGeneration !== generation) return { durationMs, startedAt };
    setLoaderTimer(() => tick(ownedGeneration), initialDelay);
    return { durationMs, startedAt };
  };

  const snapshot = () => ({ durationMs, progress, running, startedAt, timerId });

  return Object.freeze({ cancel, snapshot, start });
};
