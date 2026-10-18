// Cursor Settings: switches between the light and dark cursor packs. It
// explains itself when no pack is installed (cursor.enabled is false).

import { getCursorMode, isCursorEnabled, onCursorModeChange, setCursorMode } from "../../kit/index.js";

export default {
  id: "cursor-settings",
  title: "Cursor Settings",
  label: "Cursors",
  icon: "assets/app-icons/ico/mouse_ms.ico",
  window: { width: 340, controls: ["close"], dialog: true },
  render: () => `
    <div class="cursor-window-option">
      <img src="assets/app-icons/ico/mouse_ms.ico" width="32" height="32" alt="" />
      <div class="field-row" role="group" aria-label="Cursor color mode">
        <button type="button" data-cursor-mode="light" aria-pressed="true">Light</button>
        <button type="button" data-cursor-mode="dark" aria-pressed="false">Dark</button>
      </div>
    </div>
    <p class="cursor-settings-note" data-cursor-note hidden>
      No cursor pack is installed, so the system cursor is shown. Add one to
      <code>assets/cursors/</code> (see its README) and set <code>cursor.enabled</code>
      in <code>site.config.js</code>.
    </p>`,
  styles: ["apps/cursor-settings/cursor-settings.css"],
  mount({ window: win }) {
    const buttons = [...win.querySelectorAll("[data-cursor-mode]")];
    const note = win.querySelector("[data-cursor-note]");
    note.hidden = isCursorEnabled();
    const sync = (mode = getCursorMode()) => {
      buttons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.cursorMode === mode));
      });
    };
    onCursorModeChange(sync);
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        setCursorMode(button.dataset.cursorMode);
        sync(button.dataset.cursorMode);
      });
    });
  },
};
