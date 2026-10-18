// System-alert popups: a small centered dialog with an icon, a message and
// one or more buttons. `showAlert` resolves with the id of the pressed button
// ("dismiss" when closed with the title-bar button or Escape).

import {
  DIALOG_INITIAL_FOCUS_SELECTOR,
  closeWindow,
  createWindow,
  destroyWindow,
  getWindow,
  openWindow,
} from "./windows.js";
import { escapeHtml } from "./util.js";

const DEFAULT_ICON = "assets/app-icons/ico/msg_warning.ico";
const ALIGNMENTS = new Set(["left", "center", "right"]);

let alertCounter = 0;
const pendingResolvers = new Map();

const buttonId = (label) =>
  String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "button";

const normalizeButtons = (buttons) => {
  const list = buttons?.length ? buttons : [{ label: "OK" }];
  const used = new Set();
  return list.map((button, index) => {
    const entry = typeof button === "string" ? { label: button } : button;
    const label = String(entry.label ?? `Button ${index + 1}`);
    let id = entry.id ?? buttonId(label);
    while (used.has(id)) id = `${id}-${index}`;
    used.add(id);
    return { id, label, onClick: entry.onClick ?? null, primary: Boolean(entry.primary) };
  });
};

const renderAlert = ({ icon, body, image, buttons, buttonAlignment }) => `
  <div class="system-alert-message">
    <img src="${escapeHtml(icon)}" width="48" height="48" alt="" />
    <div class="system-alert-copy">${body}</div>
  </div>
  ${image ? `<div class="system-alert-image"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt ?? "")}" /></div>` : ""}
  <div class="system-alert-actions" data-button-alignment="${escapeHtml(buttonAlignment)}">
    ${buttons
      .map(
        (button) =>
          `<button type="button" data-alert-button="${escapeHtml(button.id)}"${button.primary ? ' class="default"' : ""}>${escapeHtml(button.label)}</button>`
      )
      .join("")}
  </div>`;

/**
 * Shows a system alert.
 *
 *   await showAlert({ title: "System Alert", icon, body: "<p>Text</p>", buttons: ["OK"] })
 *
 * `body` is trusted HTML; wrap untrusted text with `escapeHtml`. Pass an `id`
 * to reuse one window for repeated alerts of the same kind; otherwise each call
 * creates a fresh window and removes it when dismissed.
 */
export const showAlert = ({
  id = "",
  title = "System Alert",
  icon = DEFAULT_ICON,
  body = "",
  image = null,
  buttons = ["OK"],
  buttonAlignment = "right",
  width = 340,
  className = "",
} = {}) => {
  if (!ALIGNMENTS.has(buttonAlignment)) {
    throw new TypeError(`buttonAlignment must be left, center or right (got ${buttonAlignment})`);
  }
  const normalizedButtons = normalizeButtons(buttons);
  const reusable = Boolean(id);
  alertCounter += 1;
  const windowId = id || `system-alert-${alertCounter}`;
  if (reusable && getWindow(windowId)) destroyWindow(windowId);
  const definition = {
    id: windowId,
    title,
    window: {
      width,
      className: `system-alert-window ${className}`.trim(),
      controls: ["close"],
      center: true,
      dialog: true,
      resizable: false,
      noDrag: false,
      height: null,
      bodyClassName: "system-alert-body",
      bodyTabIndex: null,
    },
    render: () => renderAlert({ icon, body, image, buttons: normalizedButtons, buttonAlignment }),
    hooks: {
      onClose: () => {
        const resolve = pendingResolvers.get(windowId);
        pendingResolvers.delete(windowId);
        resolve?.("dismiss");
      },
    },
  };
  const win = createWindow(definition);
  win.querySelectorAll("[data-alert-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const pressed = normalizedButtons.find((entry) => entry.id === button.dataset.alertButton);
      pressed?.onClick?.();
      const resolve = pendingResolvers.get(windowId);
      pendingResolvers.delete(windowId);
      closeWindow(windowId);
      resolve?.(pressed?.id ?? "dismiss");
    });
  });
  if (!reusable) {
    win.addEventListener("animationend", (event) => {
      if (event.target === win && event.animationName === "retro-window-close") {
        // Keep the registry honest: one-off alerts are removed once hidden.
        destroyWindow(windowId);
      }
    });
  }
  return new Promise((resolve) => {
    pendingResolvers.set(windowId, resolve);
    openWindow(windowId);
    requestAnimationFrame(() => {
      win.querySelector(DIALOG_INITIAL_FOCUS_SELECTOR)?.focus({ preventScroll: true });
    });
  });
};

