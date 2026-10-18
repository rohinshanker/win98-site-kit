// Desktop icons, the taskbar (Start button, dock launchers, clock) and the
// page-title behaviour. Markup is generated from the installed apps and the
// `desktop` / `dock` placement lists in site.config.js.

import { escapeHtml } from "./util.js";
import { onWindowChange, isWindowOpen } from "./windows.js";

const iconMarkup = (app) =>
  `<img src="${escapeHtml(app.icon)}" alt="" class="${escapeHtml(app.iconClassName)}" />`;

const desktopIcon = (app) => `
  <button class="desktop-icon" type="button" data-app="${escapeHtml(app.id)}" aria-label="${escapeHtml(app.title)}"${app.isLink ? ` title="${escapeHtml(app.href)}"` : ""}>
    ${iconMarkup(app)}
    <span class="desktop-icon-label">${escapeHtml(app.label)}</span>
  </button>`;

const dockIcon = (app) => `
  <button class="taskbar-icon" type="button" data-app="${escapeHtml(app.id)}" aria-label="${escapeHtml(app.title)}" title="${escapeHtml(app.title)}"${app.isLink ? "" : ' aria-pressed="false"'}>
    ${iconMarkup(app)}
  </button>`;

/** Renders the desktop icon grid into `container`. */
export const renderDesktopIcons = (container, apps) => {
  container.innerHTML = apps.map(desktopIcon).join("");
};

/** Renders the taskbar; returns `{ startButton, clockButton, clock }`. */
export const renderTaskbar = (container, apps, { startLabel = "Start" } = {}) => {
  container.innerHTML = `
    <button class="start-button" type="button" title="Close every window">
      <img src="assets/app-icons/ico/windows.ico" alt="" />
      ${escapeHtml(startLabel)}
    </button>
    <span class="taskbar-divider" aria-hidden="true"></span>
    <div class="taskbar-apps" aria-label="Applications">${apps.map(dockIcon).join("")}</div>
    <span class="taskbar-divider" aria-hidden="true"></span>
    <button class="taskbar-right" type="button" id="taskbar-clock-button" aria-label="Date and time">
      <img src="assets/app-icons/ico/calendar.ico" alt="" width="16" height="16" />
      <span class="taskbar-clock" id="taskbar-clock">--:--</span>
    </button>`;
  const startButton = container.querySelector(".start-button");
  const clockButton = container.querySelector("#taskbar-clock-button");
  const clock = container.querySelector("#taskbar-clock");
  onWindowChange((id) => {
    container.querySelectorAll(`.taskbar-icon[data-app="${id}"]`).forEach((button) => {
      const open = isWindowOpen(id);
      button.classList.toggle("is-open", open);
      button.setAttribute("aria-pressed", String(open));
    });
  });
  return { startButton, clockButton, clock };
};

/** Keeps the taskbar clock current (minute resolution). */
export const startClock = (clock, { hour12 = true } = {}) => {
  const update = () => {
    clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12 });
  };
  update();
  window.setInterval(update, 30_000);
  return update;
};

/** Swaps the tab title while the page is hidden, like the original site. */
export const installAwayTitle = (awayTitle) => {
  if (!awayTitle) return;
  const homeTitle = document.title;
  document.addEventListener("visibilitychange", () => {
    document.title = document.hidden ? awayTitle : homeTitle;
  });
};
