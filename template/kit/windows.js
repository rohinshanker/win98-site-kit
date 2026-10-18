// The window manager: creates .window elements from app definitions, opens,
// closes, stacks, drags, resizes and clamps them, and routes keyboard and
// lifecycle events to the owning app. Everything is keyed by window id.

import { clamp, isPageActive, prefersReducedMotion } from "./util.js";
import { fitImagesIntoFrames, loadDeferredMedia, pauseMedia, playMedia, stopMedia } from "./media.js";

export const DIALOG_INITIAL_FOCUS_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CONTROL_LABELS = Object.freeze({
  help: "Help",
  minimize: "Minimize",
  maximize: "Maximize",
  close: "Close",
});

/** @type {Map<string, WindowRecord>} */
const records = new Map();
const viewportObservers = [];
const closeAllHooks = [];
const changeListeners = [];
const openListeners = [];
const keyHandlers = new Map();
const focusReturns = new WeakMap();
const expandedState = new WeakMap();

let topZ = 10;
let activeWindow = null;
let suspendedActiveWindow = null;
let resizeFrameId = 0;
let stack = null;

const windowStack = () => {
  if (!stack) {
    stack = document.getElementById("window-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "window-stack";
      stack.className = "window-stack";
      document.body.appendChild(stack);
    }
  }
  return stack;
};

export const getWindow = (id) => records.get(id)?.element ?? null;

export const getActiveWindow = () => activeWindow;

export const isWindowVisible = (win) =>
  Boolean(win && !win.classList.contains("is-hidden") && !win.classList.contains("is-closing"));

export const isWindowOpen = (id) => isWindowVisible(getWindow(id));

export const nextZIndex = () => {
  topZ += 1;
  return topZ;
};

/** Called with `(id, isOpen)` whenever a window opens or closes. */
export const onWindowChange = (listener) => {
  changeListeners.push(listener);
  return () => changeListeners.splice(changeListeners.indexOf(listener), 1);
};

/** Called with the window element each time it becomes visible. */
export const onWindowOpen = (listener) => {
  openListeners.push(listener);
  return () => openListeners.splice(openListeners.indexOf(listener), 1);
};

/** Observers run on every viewport resize: `{ onResize, onFrame }`. */
export const onViewportResize = (observer) => {
  viewportObservers.push(typeof observer === "function" ? { onFrame: observer } : observer);
};

/** Hooks run after the Start button closes every window. */
export const onCloseAll = (hook) => {
  closeAllHooks.push(hook);
};

/** Keyboard handler for one window while it is active; return true to stop. */
export const registerKeyHandler = (id, handler) => {
  if (!keyHandlers.has(id)) keyHandlers.set(id, []);
  keyHandlers.get(id).push(handler);
};

export const setFocusReturn = (win, element) => {
  if (win && element) focusReturns.set(win, element);
};

const emitChange = (id, isOpen) => changeListeners.forEach((listener) => listener(id, isOpen));

const taskbarClearance = () => {
  const taskbar = document.querySelector(".taskbar");
  if (!taskbar) return 0;
  const rect = taskbar.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return 0;
  return Math.max(0, window.innerHeight - rect.top);
};

const titleBarGeometry = (win, windowRect = null) => {
  const titleBar = win?.querySelector(".title-bar");
  if (!win || !titleBar) return null;
  const rect = windowRect || win.getBoundingClientRect();
  const titleRect = titleBar.getBoundingClientRect();
  return {
    height: titleRect.height,
    offsetX: titleRect.left - rect.left,
    offsetY: titleRect.top - rect.top,
    width: titleRect.width,
  };
};

/** Keeps the whole title bar reachable inside the viewport above the taskbar. */
const clampTitleBarPosition = (win, left, top, geometry = titleBarGeometry(win)) => {
  if (!geometry) return { left, top };
  const { height, offsetX, offsetY, width } = geometry;
  const viewportRight = window.innerWidth;
  const viewportBottom = window.innerHeight - taskbarClearance();
  const maxLeft = width > viewportRight ? -offsetX : viewportRight - width - offsetX;
  const minLeft = width > viewportRight ? viewportRight - width - offsetX : -offsetX;
  const maxTop = Math.max(-offsetY, viewportBottom - height - offsetY);
  return {
    left: Math.round(clamp(left, minLeft, maxLeft)),
    top: Math.round(clamp(top, -offsetY, maxTop)),
  };
};

const setClampedPosition = (win, left, top, geometry) => {
  const position = clampTitleBarPosition(win, left, top, geometry);
  win.style.left = `${position.left}px`;
  win.style.top = `${position.top}px`;
  return position;
};

/** Moves a window so it is entirely visible (used after content grows). */
export const clampIntoViewport = (win, { padding = 12 } = {}) => {
  if (!win) return null;
  const rect = win.getBoundingClientRect();
  const availableWidth = Math.max(1, window.innerWidth - padding * 2);
  const availableHeight = Math.max(1, window.innerHeight - taskbarClearance() - padding * 2);
  const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxTop = Math.max(padding, window.innerHeight - taskbarClearance() - rect.height - padding);
  const left = rect.width > availableWidth ? padding : Math.round(clamp(rect.left, padding, maxLeft));
  const top = rect.height > availableHeight ? padding : Math.round(clamp(rect.top, padding, maxTop));
  win.classList.remove("app-window--center");
  win.style.translate = "0 0";
  win.style.left = `${left}px`;
  win.style.top = `${top}px`;
  return { left, top };
};

const setResponsiveState = (win, width, height) => {
  if (!win.classList.contains("is-corner-resizable")) return;
  if (!width || !height) {
    const rect = win.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
  }
  if (!width || !height) return;
  win.classList.toggle("is-window-narrow", width < 540);
  win.classList.toggle("is-window-short", height < 360);
};

export const bringToFront = (win) => {
  if (!win || win.classList.contains("is-hidden")) return;
  if (activeWindow && activeWindow !== win) pauseMedia(activeWindow);
  activeWindow = win;
  suspendedActiveWindow = null;
  win.style.zIndex = String(nextZIndex());
  win.querySelectorAll("video[data-autoplay-on-active]").forEach(playMedia);
};

const restartAnimation = (win, className) => {
  win.classList.remove("is-opening", "is-closing");
  void win.offsetWidth;
  win.classList.add(className);
};

const finishClose = (win) => {
  stopMedia(win);
  win.classList.remove("is-closing");
  win.classList.add("is-hidden");
  // Fires once the element is actually hidden, whether or not the close
  // animation ran (reduced motion skips it). Alerts use it to clean up.
  win.dispatchEvent(new CustomEvent("kit:windowhidden"));
  const focusTarget = focusReturns.get(win);
  focusReturns.delete(win);
  const activeFocus = document.activeElement;
  if (
    focusTarget?.isConnected &&
    typeof focusTarget.focus === "function" &&
    (!activeFocus || activeFocus === document.body || win.contains(activeFocus))
  ) {
    focusTarget.focus({ preventScroll: true });
  }
};

const placeWindow = (win, options) => {
  if (options.center) {
    win.classList.add("app-window--center");
    win.style.left = "";
    win.style.top = "";
    win.style.translate = "";
    // A window taller than the space above its centre point would push its
    // title bar off screen; pin it to the top instead so Close stays reachable.
    const rect = win.getBoundingClientRect();
    if (rect.top < 8) {
      win.classList.remove("app-window--center");
      win.style.translate = "0 0";
      win.style.left = `${Math.max(8, Math.round(rect.left))}px`;
      win.style.top = "8px";
    }
    return;
  }
  const paddingX = 24;
  const paddingY = 24;
  const maxLeft = Math.max(paddingX, window.innerWidth - win.offsetWidth - paddingX);
  const maxTop = Math.max(paddingY, window.innerHeight - win.offsetHeight - 90);
  win.classList.remove("app-window--center");
  win.style.translate = "0 0";
  win.style.left = `${Math.round(paddingX + Math.random() * (maxLeft - paddingX))}px`;
  win.style.top = `${Math.round(paddingY + Math.random() * (maxTop - paddingY))}px`;
};

/** Selects a tab inside a selector window (see kit/selector.js). */
export const selectWindowTab = (win, viewId) => {
  if (!win) return;
  win.querySelectorAll(".selector-item").forEach((button) => {
    const isMatch = button.getAttribute("data-view") === viewId;
    button.classList.toggle("is-active", isMatch);
    button.setAttribute("aria-selected", String(isMatch));
  });
  win.querySelectorAll(".viewer-content").forEach((panel) => {
    const isMatch = panel.getAttribute("data-view") === viewId;
    panel.classList.toggle("is-hidden", !isMatch);
    if (isMatch) {
      loadDeferredMedia(panel);
      fitImagesIntoFrames(panel);
    } else {
      stopMedia(panel);
    }
  });
};

const resetToFirstTab = (win) => {
  const first = win.querySelector(".selector-item");
  if (first) selectWindowTab(win, first.getAttribute("data-view"));
};

export const openWindow = (id) => {
  const record = records.get(id);
  if (!record) throw new Error(`No window is registered with id "${id}"`);
  const { element: win, hooks, options } = record;
  if (isWindowVisible(win)) {
    bringToFront(win);
    hooks.onAlreadyOpen?.(win);
    return win;
  }
  win.classList.remove("is-hidden");
  win.setAttribute("aria-hidden", "false");
  hooks.onBeforeOpen?.(win);
  resetToFirstTab(win);
  bringToFront(win);
  placeWindow(win, options);
  loadDeferredMedia(win);
  fitImagesIntoFrames(win);
  setResponsiveState(win);
  hooks.onOpen?.(win);
  restartAnimation(win, "is-opening");
  openListeners.forEach((listener) => listener(win, id));
  hooks.onOpened?.(win);
  emitChange(id, true);
  return win;
};

export const closeWindow = (id) => {
  const record = records.get(id);
  if (!record) return;
  const { element: win, hooks } = record;
  if (win.classList.contains("is-hidden")) return;
  if (
    record.options.dialog &&
    document.activeElement instanceof HTMLElement &&
    !win.contains(document.activeElement)
  ) {
    focusReturns.set(win, document.activeElement);
  }
  win.setAttribute("aria-hidden", "true");
  pauseMedia(win);
  if (activeWindow === win) activeWindow = null;
  if (suspendedActiveWindow === win) suspendedActiveWindow = null;
  hooks.onClose?.(win);
  restoreSize(win);
  win.style.zIndex = String(nextZIndex());
  restartAnimation(win, "is-closing");
  if (prefersReducedMotion() || win.getAnimations().length === 0) finishClose(win);
  emitChange(id, false);
};

export const toggleWindow = (id) => {
  if (isWindowOpen(id)) closeWindow(id);
  else openWindow(id);
};

export const closeAllWindows = () => {
  records.forEach((record, id) => closeWindow(id));
  closeAllHooks.forEach((hook) => hook());
};

const restoreSize = (win) => {
  const saved = expandedState.get(win);
  win.classList.remove("is-window-expanded");
  if (!saved) {
    setResponsiveState(win);
    return;
  }
  win.style.width = saved.width;
  win.style.height = saved.height;
  win.style.left = saved.left;
  win.style.top = saved.top;
  win.style.translate = saved.translate;
  win.classList.toggle("app-window--center", saved.centered);
  expandedState.delete(win);
  setResponsiveState(win);
  records.get(win.dataset.appWindow)?.hooks.onResize?.(win);
};

/** Maximize: fill the viewport above the taskbar; a second click restores. */
export const toggleMaximize = (win) => {
  if (!win) return;
  if (expandedState.has(win)) {
    restoreSize(win);
    return;
  }
  expandedState.set(win, {
    width: win.style.width,
    height: win.style.height,
    left: win.style.left,
    top: win.style.top,
    translate: win.style.translate,
    centered: win.classList.contains("app-window--center"),
  });
  const margin = 12;
  win.classList.remove("app-window--center");
  win.classList.add("is-window-expanded");
  win.style.translate = "0 0";
  win.style.left = `${margin}px`;
  win.style.top = `${margin}px`;
  win.style.width = `${Math.max(240, window.innerWidth - margin * 2)}px`;
  win.style.height = `${Math.max(180, window.innerHeight - taskbarClearance() - margin * 2)}px`;
  setResponsiveState(win);
  records.get(win.dataset.appWindow)?.hooks.onResize?.(win);
};

const isResizeCorner = (win, event) => {
  const rect = win.getBoundingClientRect();
  const hitSize = 24;
  return (
    event.clientX >= rect.right - hitSize &&
    event.clientX <= rect.right &&
    event.clientY >= rect.bottom - hitSize &&
    event.clientY <= rect.bottom
  );
};

const initCornerResize = (win, hooks) => {
  win.classList.add("is-corner-resizable");
  win.addEventListener("pointermove", (event) => {
    if (win.classList.contains("is-manual-resizing")) return;
    win.classList.toggle("is-resize-hover", isResizeCorner(win, event));
  });
  win.addEventListener("pointerleave", () => {
    if (!win.classList.contains("is-manual-resizing")) win.classList.remove("is-resize-hover");
  });
  win.addEventListener(
    "pointerdown",
    (event) => {
      if (!isResizeCorner(win, event)) return;
      if (event.button !== 0 && event.pointerType !== "touch") return;
      event.preventDefault();
      event.stopPropagation();
      bringToFront(win);
      expandedState.delete(win);
      win.classList.remove("is-window-expanded");
      const rect = win.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const minWidth = clamp(window.innerWidth - 24, 240, 280);
      const minHeight = clamp(window.innerHeight - 96, 180, 220);
      const maxWidth = Math.max(minWidth, window.innerWidth - rect.left - 12);
      const maxHeight = Math.max(minHeight, window.innerHeight - rect.top - taskbarClearance() - 6);
      win.classList.remove("app-window--center");
      win.classList.add("is-manual-resizing");
      document.body.classList.add("is-resizing-window");
      win.style.translate = "0 0";
      win.style.left = `${rect.left}px`;
      win.style.top = `${rect.top}px`;
      win.setPointerCapture(event.pointerId);

      const resize = (moveEvent) => {
        const width = Math.round(clamp(rect.width + moveEvent.clientX - startX, minWidth, maxWidth));
        const height = Math.round(clamp(rect.height + moveEvent.clientY - startY, minHeight, maxHeight));
        win.style.width = `${width}px`;
        win.style.height = `${height}px`;
        setResponsiveState(win, width, height);
        hooks.onResize?.(win);
      };
      const finish = (upEvent) => {
        if (win.hasPointerCapture(upEvent.pointerId)) win.releasePointerCapture(upEvent.pointerId);
        win.classList.remove("is-manual-resizing", "is-resize-hover");
        document.body.classList.remove("is-resizing-window");
        win.removeEventListener("pointermove", resize);
        win.removeEventListener("pointerup", finish);
        win.removeEventListener("pointercancel", finish);
      };
      win.addEventListener("pointermove", resize);
      win.addEventListener("pointerup", finish);
      win.addEventListener("pointercancel", finish);
    },
    { capture: true }
  );
  setResponsiveState(win);
};

const initDrag = (win, hooks) => {
  win.addEventListener("pointerdown", () => bringToFront(win), { capture: true });
  const titleBar = win.querySelector(".title-bar");
  if (!titleBar || win.hasAttribute("data-no-drag")) return;
  titleBar.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".title-bar-controls")) return;
    if (event.button !== 0 && event.pointerType !== "touch") return;
    for (const animation of win.getAnimations()) {
      if (animation.animationName === "retro-window-open") animation.finish();
    }
    const rect = win.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const geometry = titleBarGeometry(win, rect);
    if (win.classList.contains("app-window--center")) {
      win.style.left = `${rect.left}px`;
      win.style.top = `${rect.top}px`;
    }
    win.classList.remove("app-window--center");
    win.style.translate = "0 0";
    titleBar.setPointerCapture(event.pointerId);
    document.body.classList.add("is-dragging-window");

    const move = (moveEvent) => {
      setClampedPosition(win, moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, geometry);
    };
    const up = (upEvent) => {
      if (titleBar.hasPointerCapture(upEvent.pointerId)) titleBar.releasePointerCapture(upEvent.pointerId);
      titleBar.removeEventListener("pointermove", move);
      titleBar.removeEventListener("pointerup", up);
      titleBar.removeEventListener("pointercancel", up);
      document.body.classList.remove("is-dragging-window");
      const finalRect = win.getBoundingClientRect();
      setClampedPosition(win, finalRect.left, finalRect.top);
      hooks.onDragEnd?.(win);
    };
    titleBar.addEventListener("pointermove", move);
    titleBar.addEventListener("pointerup", up);
    titleBar.addEventListener("pointercancel", up);
  });
};

const renderBody = (render, context) => {
  const content = render(context);
  if (content instanceof Node) return content;
  const template = document.createElement("template");
  template.innerHTML = String(content ?? "");
  return template.content;
};

/**
 * Creates and registers a window. `definition` carries `{ id, title, window,
 * render, mount, hooks }` (see kit/apps.js); `context` is handed to `mount`.
 * Returns the `.window` element, hidden until `openWindow(id)`.
 */
export const createWindow = (definition, context = {}) => {
  const { id, title } = definition;
  if (records.has(id)) throw new Error(`A window with id "${id}" already exists`);
  const options = definition.window;
  const hooks = definition.hooks ?? {};
  const win = document.createElement("div");
  win.className = `window app-window is-hidden ${options.className}`.trim();
  win.dataset.appWindow = id;
  win.id = `${id}-window`;
  win.setAttribute("aria-hidden", "true");
  if (options.noDrag) win.setAttribute("data-no-drag", "");
  if (options.width !== null) {
    win.style.width = typeof options.width === "number" ? `${options.width}px` : options.width;
  }
  if (options.height !== null) {
    win.style.height = typeof options.height === "number" ? `${options.height}px` : options.height;
  }
  const titleId = `${id}-window-title`;
  if (options.dialog) {
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "false");
    win.setAttribute("aria-labelledby", titleId);
  }

  const titleBar = document.createElement("div");
  titleBar.className = "title-bar";
  const titleText = document.createElement("div");
  titleText.className = "title-bar-text";
  titleText.id = titleId;
  titleText.textContent = title;
  const controls = document.createElement("div");
  controls.className = "title-bar-controls";
  for (const control of options.controls) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", CONTROL_LABELS[control]);
    button.dataset.windowControl = control;
    if (control === "close") button.dataset.close = id;
    controls.appendChild(button);
  }
  titleBar.append(titleText, controls);

  const body = document.createElement("div");
  body.className = `window-body ${options.bodyClassName}`.trim();
  if (options.bodyTabIndex !== null) body.tabIndex = options.bodyTabIndex;
  body.appendChild(renderBody(definition.render, { ...context, id }));
  win.append(titleBar, body);
  windowStack().appendChild(win);

  win.addEventListener("animationend", (event) => {
    if (event.target !== win) return;
    if (event.animationName === "retro-window-open") win.classList.remove("is-opening");
    if (event.animationName === "retro-window-close") finishClose(win);
  });
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window-control]");
    if (!button) return;
    event.preventDefault();
    const control = button.dataset.windowControl;
    if (control === "close" || control === "minimize") closeWindow(id);
    else if (control === "maximize") toggleMaximize(win);
    else if (control === "help") hooks.onHelp?.(win);
  });
  initDrag(win, hooks);
  if (options.resizable) initCornerResize(win, hooks);

  records.set(id, { element: win, options, hooks, definition });
  definition.mount?.({ ...context, id, window: win, body });
  return win;
};

/** Removes a window and its registration (used for one-off alerts). */
export const destroyWindow = (id) => {
  const record = records.get(id);
  if (!record) return;
  const win = record.element;
  if (activeWindow === win) activeWindow = null;
  if (suspendedActiveWindow === win) suspendedActiveWindow = null;
  records.delete(id);
  keyHandlers.delete(id);
  win.remove();
};

/** Binds every `[data-app]` launcher under `root` (buttons, links, menu items). */
export const bindLaunchers = (root, launch) => {
  root.querySelectorAll("[data-app]").forEach((button) => {
    if (button.dataset.launcherBound === "true") return;
    button.dataset.launcherBound = "true";
    button.addEventListener("click", (event) => launch(button.dataset.app, event, button));
  });
};

const lockMobileViewportZoom = () => {
  let lastTouchEndAt = 0;
  const blockGesture = (event) => event.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    document.addEventListener(eventName, blockGesture, { passive: false });
  });
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches && event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest("input, textarea, select")) return;
      const now = Date.now();
      if (now - lastTouchEndAt <= 300) event.preventDefault();
      lastTouchEndAt = now;
    },
    { passive: false }
  );
};

const dispatchResize = () => {
  viewportObservers.forEach((observer) => observer.onResize?.());
  if (resizeFrameId) return;
  resizeFrameId = requestAnimationFrame(() => {
    resizeFrameId = 0;
    const visible = [...records.entries()].filter(([, record]) => isWindowVisible(record.element));
    const sizes = visible.map(([, record]) => {
      const rect = record.element.getBoundingClientRect();
      return { record, rect };
    });
    sizes.forEach(({ record, rect }) => {
      setResponsiveState(record.element, rect.width, rect.height);
      record.hooks.onResize?.(record.element);
    });
    viewportObservers.forEach((observer) => observer.onFrame?.());
    sizes.forEach(({ record, rect }) => {
      const win = record.element;
      if (win.classList.contains("app-window--center") || win.hasAttribute("data-no-drag")) return;
      setClampedPosition(win, rect.left, rect.top);
    });
  });
};

const dispatchKeydown = (event) => {
  if (event.key === "Escape") {
    const candidates = [
      document.activeElement instanceof Element ? document.activeElement.closest("[data-app-window]") : null,
      activeWindow,
      ...document.querySelectorAll('[data-app-window][role="dialog"]'),
    ];
    const dialog = candidates.find(
      (win) => win && win.getAttribute("role") === "dialog" && isWindowVisible(win)
    );
    if (dialog) {
      event.preventDefault();
      closeWindow(dialog.dataset.appWindow);
      return;
    }
  }
  if (event.defaultPrevented || !isPageActive(document)) return;
  if (!isWindowVisible(activeWindow)) return;
  const id = activeWindow.dataset.appWindow;
  const record = records.get(id);
  if (record?.hooks.onKeydown?.(event, activeWindow) || event.defaultPrevented) return;
  for (const handler of keyHandlers.get(id) ?? []) {
    if (handler(event, activeWindow) || event.defaultPrevented) break;
  }
};

const pauseActiveWindowMedia = () => {
  if (!activeWindow) return;
  suspendedActiveWindow = activeWindow;
  pauseMedia(activeWindow);
  activeWindow = null;
};

const restoreSuspendedWindow = () => {
  if (activeWindow || !suspendedActiveWindow || !isPageActive(document)) return;
  if (!isWindowVisible(suspendedActiveWindow)) {
    suspendedActiveWindow = null;
    return;
  }
  activeWindow = suspendedActiveWindow;
  suspendedActiveWindow = null;
};

let installed = false;

/** Installs the document-level listeners once. boot.js calls this. */
export const installWindowManager = () => {
  if (installed) return;
  installed = true;
  lockMobileViewportZoom();
  window.addEventListener("resize", dispatchResize);
  document.addEventListener("keydown", dispatchKeydown);
  window.addEventListener("blur", pauseActiveWindowMedia);
  window.addEventListener("focus", restoreSuspendedWindow);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!activeWindow || !isWindowVisible(activeWindow)) return;
      if (activeWindow.contains(event.target)) return;
      pauseMedia(activeWindow);
      activeWindow = null;
      suspendedActiveWindow = null;
    },
    { capture: true }
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseActiveWindowMedia();
    else restoreSuspendedWindow();
  });
};
