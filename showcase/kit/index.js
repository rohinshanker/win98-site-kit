// The public kit API. Apps import what they need from here:
//
//   import { openWindow, showAlert, createCarousel } from "../../kit/index.js";
//
// (Everything is also available at runtime as `window.win98SiteKit`.)

export * from "./util.js";
export * as storage from "./storage.js";
export { el, htmlToElement, htmlToFragment, one, all } from "./dom.js";
export {
  DIALOG_INITIAL_FOCUS_SELECTOR,
  bindLaunchers,
  bringToFront,
  clampIntoViewport,
  closeAllWindows,
  closeWindow,
  createWindow,
  destroyWindow,
  getActiveWindow,
  getWindow,
  isWindowOpen,
  isWindowVisible,
  onCloseAll,
  onViewportResize,
  onWindowChange,
  onWindowOpen,
  openWindow,
  registerKeyHandler,
  selectWindowTab,
  setFocusReturn,
  toggleMaximize,
  toggleWindow,
} from "./windows.js";
export { showAlert } from "./alerts.js";
export { createCarousel, carouselFor, mountDeclaredCarousels } from "./carousel.js";
export { selectorWindowBody, mountSelectorWindow } from "./selector.js";
export {
  backgroundChoices,
  getBackground,
  onBackgroundChange,
  resetBackground,
  setBackground,
  timeOfDayPhase,
} from "./background.js";
export {
  CURSOR_FILES,
  getCursorMode,
  isCursorEnabled,
  observeLoading,
  onCursorModeChange,
  setCursorMode,
} from "./cursor.js";
export { closeCalendar, isCalendarOpen, openCalendar, toggleCalendar } from "./calendar.js";
export {
  fitImagesIntoFrames,
  isVideoSource,
  loadDeferredMedia,
  pauseMedia,
  playMedia,
  preloadMediaSource,
  preloadMediaSourcesInOrder,
  setLoading,
  stopMedia,
} from "./media.js";
