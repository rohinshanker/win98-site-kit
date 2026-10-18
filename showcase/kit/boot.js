// Entry point. index.html loads this module; it reads site.config.js and
// apps/installed.js, builds the desktop, and mounts every app's window.

import config from "../site.config.js";
import installedApps from "../apps/installed.js";
import { normalizeConfig } from "./config.js";
import { expandPlacement, normalizeApps } from "./apps.js";
import {
  bindLaunchers,
  closeAllWindows,
  createWindow,
  installWindowManager,
  openWindow,
  toggleWindow,
} from "./windows.js";
import { installAwayTitle, renderDesktopIcons, renderTaskbar, startClock } from "./desktop.js";
import { initCalendar } from "./calendar.js";
import { initBackground } from "./background.js";
import { initCursor } from "./cursor.js";
import { mountDeclaredCarousels } from "./carousel.js";
import { fitImagesIntoFrames } from "./media.js";
import * as kit from "./index.js";

const injectStyles = (apps) => {
  const seen = new Set();
  const loads = [];
  for (const app of apps) {
    for (const href of app.styles) {
      if (seen.has(href)) continue;
      seen.add(href);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      loads.push(new Promise((resolve) => {
        link.addEventListener("load", resolve, { once: true });
        link.addEventListener("error", resolve, { once: true });
      }));
      document.head.appendChild(link);
    }
  }
  return Promise.all(loads);
};

const launch = (apps) => (appId, event, button) => {
  const app = apps.find((entry) => entry.id === appId);
  if (!app) throw new Error(`Launcher points at unknown app "${appId}"`);
  if (app.hooks.onLaunch?.(event, button)) return;
  if (app.isLink) {
    window.open(app.href, "_blank", "noopener,noreferrer");
    return;
  }
  if (!app.hasWindow) return;
  toggleWindow(app.id);
  if (app.window.dialog && kit.isWindowOpen(app.id)) {
    const win = kit.getWindow(app.id);
    kit.setFocusReturn(win, button);
    requestAnimationFrame(() => {
      const body = win.querySelector(".window-body");
      (body?.querySelector(kit.DIALOG_INITIAL_FOCUS_SELECTOR) || win.querySelector(kit.DIALOG_INITIAL_FOCUS_SELECTOR))?.focus({
        preventScroll: true,
      });
    });
  }
};

export const boot = async () => {
  const site = normalizeConfig(config);
  const apps = normalizeApps(installedApps);
  const ids = apps.map((app) => app.id);
  const desktopIds = expandPlacement(site.desktop, ids, "desktop");
  const dockIds = expandPlacement(site.dock, ids, "dock");
  const byId = (id) => apps.find((app) => app.id === id);

  document.title = site.title;
  installAwayTitle(site.awayTitle);
  initBackground(site.background, site.storagePrefix);
  initCursor(site.cursor, site.storagePrefix);
  await injectStyles(apps);

  installWindowManager();
  const context = { kit, config: site, apps };
  for (const app of apps) {
    if (app.hasWindow) createWindow(app, { ...context, app });
    for (const extra of app.windows) createWindow(extra, { ...context, app });
    if (!app.hasWindow && !app.isLink) app.mount?.({ ...context, app, id: app.id, window: null, body: null });
  }
  mountDeclaredCarousels(document);
  fitImagesIntoFrames(document);

  const desktop = document.querySelector(".desktop");
  const taskbar = document.querySelector(".taskbar");
  renderDesktopIcons(desktop, desktopIds.map(byId));
  const { startButton, clockButton, clock } = renderTaskbar(taskbar, dockIds.map(byId), {
    startLabel: site.startButtonLabel,
  });
  startClock(clock, site.clock);
  startButton.addEventListener("click", closeAllWindows);
  initCalendar(site.calendar, clockButton, site.clock);
  bindLaunchers(document, launch(apps));
  for (const app of apps) {
    if (!app.decorateLauncher) continue;
    document.querySelectorAll(`[data-app="${app.id}"]`).forEach((button) => app.decorateLauncher(button));
  }

  // Deep links: index.html#about opens that window on arrival.
  const openFromHash = () => {
    const id = window.location.hash.slice(1);
    if (id && ids.includes(id) && byId(id).hasWindow) openWindow(id);
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

  document.documentElement.classList.add("is-desktop-ready");
  window.win98SiteKit = Object.freeze({ ...kit, config: site, apps });
  return window.win98SiteKit;
};

boot().catch((error) => {
  console.error("[win98-site-kit] boot failed", error);
  const notice = document.createElement("pre");
  notice.className = "boot-error";
  notice.textContent = `The desktop could not start:\n${error.message}`;
  document.body.appendChild(notice);
});
