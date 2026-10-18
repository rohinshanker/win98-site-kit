// Components: a selector window that shows every reusable building block
// (98.css widgets, kit carousels, alerts, windows, the icon set and the
// spacing tokens) as a live demo next to the snippet that reproduces it.
// The catalogue itself lives in sections.js; this file wires behaviour.

import {
  closeWindow,
  createCarousel,
  escapeHtml,
  mountSelectorWindow,
  onWindowChange,
  openWindow,
  selectorWindowBody,
  showAlert,
} from "../../kit/index.js";
import { filterIcons, paginate } from "./icons.js";
import { CAROUSEL_DEMOS, EXTRA_WINDOW_ID, ICON_PAGE_SIZE, SECTIONS, SPACING_TOKENS } from "./sections.js";

const ICON_MANIFEST = "assets/app-icons/manifest.json";
const ICON_DIR = "assets/app-icons/ico/";

// ---------------------------------------------------------------- panels

const mountTabs = (root) => {
  root.querySelectorAll("[data-tabs]").forEach((tabs) => {
    const stage = tabs.closest(".demo-stage");
    tabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[role=tab]");
      if (!tab) return;
      event.preventDefault();
      tabs.querySelectorAll("[role=tab]").forEach((item) => {
        item.setAttribute("aria-selected", String(item === tab));
      });
      const target = tab.querySelector("a").getAttribute("href").slice(1);
      stage.querySelectorAll("[data-tab-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== target;
      });
    });
  });
};

const mountProgress = (root) => {
  const slider = root.querySelector("#components-progress");
  const meter = slider.closest(".demo-stage").querySelector(".progress-indicator:not(.segmented)");
  const bar = meter.querySelector(".progress-indicator-bar");
  slider.addEventListener("input", () => {
    const value = Number(slider.value);
    bar.style.width = `${value}%`;
    meter.setAttribute("aria-valuenow", String(value));
  });
};

// ------------------------------------------------------------- carousels

const mountCarousels = (root) => {
  for (const demo of CAROUSEL_DEMOS) {
    const container = root.querySelector(`[data-carousel="${demo.variant}"]`);
    if (demo.aspect) container.style.setProperty("--gallery-aspect", demo.aspect);
    createCarousel(container, demo.items, { variant: demo.variant, label: demo.label });
  }
};

// ---------------------------------------------------------------- alerts

const ALERTS = {
  one: () =>
    showAlert({
      title: "System Alert",
      icon: "assets/app-icons/ico/msg_information.ico",
      body: "<p>Settings were saved.</p>",
      buttons: ["OK"],
    }),
  three: (alignment) =>
    showAlert({
      title: "Notepad",
      icon: "assets/app-icons/ico/msg_question.ico",
      body: "<p>The text in Untitled has changed.</p><p>Do you want to save the changes?</p>",
      buttons: [{ id: "yes", label: "Yes", primary: true }, "No", "Cancel"],
      buttonAlignment: alignment,
    }),
  image: () =>
    showAlert({
      title: "Picture",
      icon: "assets/app-icons/ico/msg_warning.ico",
      body: "<p>Alerts can carry an image.</p>",
      image: { src: "assets/components/slide-wide.svg", alt: "A slide" },
      width: 420,
    }),
};

const mountAlerts = (root) => {
  const result = root.querySelector("[data-alert-result]");
  const alignment = () => root.querySelector('input[name="components-align"]:checked').value;
  root.querySelectorAll("[data-alert]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.alert;
      result.textContent = `Waiting for the "${button.textContent}" alert…`;
      const pressed = await ALERTS[kind](alignment());
      result.textContent = `showAlert resolved with "${pressed}"`;
    });
  });
};

// --------------------------------------------------------------- windows

const mountWindows = (root) => {
  const state = root.querySelector("[data-window-state]");
  root.querySelectorAll("[data-open-window]").forEach((button) => {
    button.addEventListener("click", () => openWindow(button.dataset.openWindow));
  });
  onWindowChange((id, isOpen) => {
    if (id === EXTRA_WINDOW_ID) state.textContent = `Extra window: ${isOpen ? "open" : "closed"}`;
  });
};

// ----------------------------------------------------------------- icons

const iconCell = (name) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-cell";
  button.setAttribute("role", "listitem");
  button.dataset.icon = name;
  button.title = name;
  const image = document.createElement("img");
  image.src = `${ICON_DIR}${name}`;
  image.width = 32;
  image.height = 32;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  const label = document.createElement("span");
  label.textContent = name;
  button.append(image, label);
  return button;
};

const copyToClipboard = async (text) => {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const mountIconBrowser = async (root) => {
  const search = root.querySelector("#components-icon-search");
  const status = root.querySelector("[data-icon-status]");
  const grid = root.querySelector("[data-icon-grid]");
  const previous = root.querySelector("[data-icon-prev]");
  const next = root.querySelector("[data-icon-next]");
  const pageLabel = root.querySelector("[data-icon-page]");
  const pathInput = root.querySelector("#components-icon-path");
  const copyNote = root.querySelector("[data-icon-copy-note]");
  let names = [];
  let page = 0;

  const render = () => {
    const query = search.value.trim();
    const matches = filterIcons(names, query);
    const view = paginate(matches, page, ICON_PAGE_SIZE);
    page = view.page;
    if (view.items.length) {
      grid.replaceChildren(...view.items.map(iconCell));
    } else {
      const empty = document.createElement("p");
      empty.className = "icon-grid-empty";
      empty.textContent = `No icon name contains "${query}".`;
      grid.replaceChildren(empty);
    }
    status.textContent = query
      ? `${view.total} of ${names.length} icons match "${query}"`
      : `${names.length} icons`;
    pageLabel.textContent = `${view.page + 1} of ${view.pageCount}`;
    previous.disabled = view.page === 0;
    next.disabled = view.page >= view.pageCount - 1;
  };

  const choose = async (button) => {
    grid.querySelectorAll(".is-selected").forEach((cell) => cell.classList.remove("is-selected"));
    button.classList.add("is-selected");
    const path = `${ICON_DIR}${button.dataset.icon}`;
    pathInput.value = path;
    const copied = await copyToClipboard(path);
    copyNote.textContent = copied
      ? `Copied ${path} to the clipboard.`
      : `Clipboard not available here; select the path above to copy it.`;
  };

  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-icon]");
    if (button) void choose(button);
  });
  search.addEventListener("input", () => {
    page = 0;
    render();
  });
  previous.addEventListener("click", () => {
    page -= 1;
    render();
  });
  next.addEventListener("click", () => {
    page += 1;
    render();
  });

  try {
    const response = await fetch(ICON_MANIFEST);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new TypeError("manifest is not a JSON array");
    names = list.map(String);
  } catch (error) {
    status.textContent = `Could not load ${ICON_MANIFEST}: ${error.message}`;
    return;
  }
  render();
};

// --------------------------------------------------------------- spacing

const mountSpacing = (root) => {
  const styles = getComputedStyle(document.documentElement);
  for (const token of SPACING_TOKENS) {
    const value = styles.getPropertyValue(token.name).trim();
    root.querySelector(`[data-token="${token.name}"]`).textContent = value || "(not set)";
  }
};

// ------------------------------------------------------------------ app

const sectionRoot = (win, id) => win.querySelector(`.viewer-content[data-view="${id}"]`);

export default {
  id: "components",
  title: "Components",
  icon: "assets/app-icons/ico/appwizard.ico",
  styles: ["apps/components/components.css"],
  window: {
    className: "selector-window components-window",
    controls: ["minimize", "maximize", "close"],
    resizable: true,
  },
  render: () => selectorWindowBody(SECTIONS, { listLabel: "Components" }),
  mount({ window: win }) {
    mountSelectorWindow(win);
    mountTabs(sectionRoot(win, "panels"));
    mountProgress(sectionRoot(win, "panels"));
    mountCarousels(sectionRoot(win, "carousels"));
    mountAlerts(sectionRoot(win, "alerts"));
    mountWindows(sectionRoot(win, "windows"));
    void mountIconBrowser(sectionRoot(win, "icons"));
    mountSpacing(sectionRoot(win, "spacing"));
  },
  windows: [
    {
      id: EXTRA_WINDOW_ID,
      title: "Extra window",
      window: { width: 320, controls: ["close"], center: true, dialog: true },
      render: () => `
        <p>
          Declared in the <code>windows</code> list of the ${escapeHtml("Components")} app:
          320px wide, centred and a dialog, so Escape closes it and focus returns.
        </p>
        <div class="action-row">
          <button type="button" class="default" data-close-extra>Close</button>
        </div>`,
      mount({ window: win }) {
        win.querySelector("[data-close-extra]").addEventListener("click", () => closeWindow(EXTRA_WINDOW_ID));
      },
    },
  ],
};
