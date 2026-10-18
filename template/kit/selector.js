// Selector windows: an explorer-style list on the left and a viewer panel on
// the right, like the Projects / Writing / Creative Work windows. Use
// `selectorWindowBody` in an app's render() and `mountSelectorWindow` in its
// mount(); set `window.resizable: true` and `className: "selector-window"`.
//
//   selectorWindowBody([
//     { id: "one", title: "First", description: "Spring 2026", icon: "assets/…ico", html: "<p>…</p>" },
//   ])

import { escapeHtml, clamp } from "./util.js";
import { selectWindowTab } from "./windows.js";

const normalizeItem = (item, index) => {
  if (!item?.id || !item.title) throw new TypeError(`Selector item ${index} needs an id and a title`);
  return item;
};

export const selectorWindowBody = (rawItems, { listLabel = "Sections" } = {}) => {
  const items = rawItems.map(normalizeItem);
  const list = items
    .map(
      (item, index) => `
        <li role="presentation">
          <button class="selector-item${index === 0 ? " is-active" : ""}" type="button" role="tab" data-view="${escapeHtml(item.id)}" aria-selected="${index === 0}">
            ${item.icon ? `<img class="selector-thumb${item.iconClassName ? ` ${escapeHtml(item.iconClassName)}` : ""}" src="${escapeHtml(item.icon)}" alt="" />` : '<span class="selector-thumb"></span>'}
            <span>
              <span class="selector-title">${escapeHtml(item.title)}</span>
              ${item.description ? `<span class="selector-desc">${item.description}</span>` : ""}
            </span>
          </button>
        </li>`
    )
    .join("");
  const panels = items
    .map(
      (item, index) => `
        <div class="viewer-content${index === 0 ? "" : " is-hidden"}" data-view="${escapeHtml(item.id)}" role="tabpanel">
          ${item.html ?? ""}
        </div>`
    )
    .join("");
  return `
    <div class="selector-panel">
      <ul class="selector-list" role="tablist" aria-label="${escapeHtml(listLabel)}">${list}</ul>
    </div>
    <div class="panel-divider" role="separator" aria-orientation="vertical"></div>
    <div class="viewer-panel">${panels}</div>`;
};

/** Binds tab switching and the draggable divider. Returns `{ select(id) }`. */
export const mountSelectorWindow = (win, { onTabChange } = {}) => {
  const body = win.querySelector(".window-body");
  const selectorPanel = win.querySelector(".selector-panel");
  const divider = win.querySelector(".panel-divider");
  win.querySelectorAll(".selector-item").forEach((button) => {
    button.addEventListener("click", () => {
      const viewId = button.getAttribute("data-view");
      selectWindowTab(win, viewId);
      onTabChange?.(viewId, win);
    });
  });
  if (divider && selectorPanel && body) {
    divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      event.preventDefault();
      const bodyRect = body.getBoundingClientRect();
      const startX = event.clientX;
      const startWidth = selectorPanel.getBoundingClientRect().width;
      const minWidth = 160;
      const maxWidth = clamp(bodyRect.width - 220, minWidth, 420);
      divider.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const width = clamp(startWidth + moveEvent.clientX - startX, minWidth, maxWidth);
        selectorPanel.style.width = `${width}px`;
        selectorPanel.style.flexBasis = `${width}px`;
      };
      const up = (upEvent) => {
        if (divider.hasPointerCapture(upEvent.pointerId)) divider.releasePointerCapture(upEvent.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }
  return Object.freeze({
    select: (viewId) => {
      selectWindowTab(win, viewId);
      onTabChange?.(viewId, win);
    },
  });
};
