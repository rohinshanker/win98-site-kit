// Study Resources: an Explorer-style window with a folder tree, a list or
// gallery file pane, an address bar, a PDF preview pane with open, new-tab
// and download actions, and a status bar. The content tree lives in
// resources.js; explorer.js holds the pure indexing and navigation logic.

import { escapeHtml, getWindow, isWindowOpen, loadDeferredMedia, openWindow } from "../../kit/index.js";
import * as explorer from "./explorer.js";
import resources, { ROOT_NAME } from "./resources.js";

const ID = "study-resources";
const VIEWER_ID = "study-pdf";

const ICONS = Object.freeze({
  folderClosed: "assets/app-icons/ico/directory_closed.ico",
  folderOpen: "assets/app-icons/ico/directory_open.ico",
  pdf: "assets/app-icons/ico/document.ico",
  link: "assets/app-icons/ico/html2.ico",
  list: "assets/app-icons/ico/appwizard_list.ico",
  gallery: "assets/app-icons/ico/user_card_view.ico",
  download: "assets/app-icons/ico/floppy_drive_3-5.ico",
});

const toolButton = (action, icon, label, { title, pressed = null, active = false, disabled = false } = {}) => `
  <button
    class="study-tool-button${active ? " is-active" : ""}"
    type="button"
    data-study-action="${action}"
    title="${escapeHtml(title)}"
    ${pressed === null ? "" : `aria-pressed="${pressed}"`}
    ${disabled ? "disabled" : ""}
  >
    <img data-src="${icon}" alt="" />
    ${escapeHtml(label)}
  </button>`;

const actionButton = (action, icon, label) => `
  <button type="button" data-study-action="${action}" disabled>
    <img data-src="${icon}" alt="" />
    ${escapeHtml(label)}
  </button>`;

const render = () => `
  <div class="study-explorer" aria-label="Study resources file explorer">
    <div class="study-menu-bar" aria-label="Explorer menu">
      <span>File</span>
      <span>Edit</span>
      <span>View</span>
      <span>Tools</span>
      <span>Help</span>
    </div>
    <div class="study-toolbar" aria-label="Explorer toolbar">
      ${toolButton("up", ICONS.folderOpen, "Up", { title: "Up one level", disabled: true })}
      <div class="vertical-bar" aria-hidden="true"></div>
      ${toolButton("list", ICONS.list, "List", { title: "List view", pressed: true, active: true })}
      ${toolButton("gallery", ICONS.gallery, "Gallery", { title: "Gallery view", pressed: false })}
    </div>
    <div class="study-address-row">
      <span class="study-address-label">Address</span>
      <div
        class="study-address-field"
        data-study-part="address"
        role="textbox"
        aria-label="Current path"
        aria-readonly="true"
      >${escapeHtml(ROOT_NAME)}</div>
    </div>
    <div class="study-main">
      <section class="study-tree-pane" aria-label="Folder hierarchy">
        <div data-study-part="tree"></div>
      </section>
      <section class="study-right-pane" aria-label="Folder contents and preview">
        <div class="study-file-header">
          <span class="study-file-title" data-study-part="current-title">${escapeHtml(ROOT_NAME)}</span>
          <span class="study-file-count" data-study-part="item-count">0 objects</span>
        </div>
        <div class="study-file-pane is-list" data-study-part="file-pane" aria-label="Folder contents"></div>
        <div class="study-preview-pane" aria-label="Preview">
          <div class="study-preview-header">
            <img class="study-preview-icon" data-study-part="preview-icon" src="${ICONS.folderOpen}" width="18" height="18" alt="" />
            <span class="study-preview-title" data-study-part="preview-title">${escapeHtml(ROOT_NAME)}</span>
          </div>
          <div class="study-preview-body" data-study-part="preview-body"></div>
          <div class="study-preview-actions">
            ${actionButton("open-window", ICONS.pdf, "Open in window")}
            ${actionButton("open-tab", ICONS.link, "Open in new tab")}
            ${actionButton("download", ICONS.download, "Download")}
          </div>
        </div>
      </section>
    </div>
    <div class="study-status-bar" aria-label="Explorer status">
      <div class="study-status-field" data-study-part="status-left">0 objects</div>
      <div class="study-status-field" data-study-part="status-right">${escapeHtml(ROOT_NAME)}</div>
    </div>
  </div>`;

const createIcon = (src) => {
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  return image;
};

const createText = (className, text) => {
  const element = document.createElement("span");
  if (className) element.className = className;
  element.textContent = text;
  return element;
};

const createEmpty = (text, className) => {
  const empty = document.createElement("div");
  empty.className = className;
  empty.textContent = text;
  return empty;
};

const createFileListHeader = () => {
  const header = document.createElement("div");
  header.className = "study-file-list-header";
  header.setAttribute("aria-hidden", "true");
  for (const label of ["", "Name", "Type", "Items", "Size"]) header.appendChild(createText("", label));
  return header;
};

const rowLabel = (node) => `${node.name}, ${explorer.typeText(node)}, ${explorer.metadataText(node)}`;

const mount = ({ window: win }) => {
  const part = (name) => win.querySelector(`[data-study-part="${name}"]`);
  const action = (name) => win.querySelector(`[data-study-action="${name}"]`);
  const parts = {
    tree: part("tree"),
    filePane: part("file-pane"),
    address: part("address"),
    currentTitle: part("current-title"),
    itemCount: part("item-count"),
    previewIcon: part("preview-icon"),
    previewTitle: part("preview-title"),
    previewBody: part("preview-body"),
    statusLeft: part("status-left"),
    statusRight: part("status-right"),
  };
  const buttons = {
    up: action("up"),
    list: action("list"),
    gallery: action("gallery"),
    openWindow: action("open-window"),
    openTab: action("open-tab"),
    download: action("download"),
  };
  const explorerRoot = win.querySelector(".study-explorer");
  const index = explorer.createIndex(resources, ROOT_NAME);
  let state = explorer.createState(index);

  const idOf = new Map([...index.entries.values()].map((entry) => [entry.node, entry.id]));

  const iconFor = (node) => {
    if (explorer.isPdf(node)) return ICONS.pdf;
    if (explorer.isLink(node)) return ICONS.link;
    return state.expandedIds.has(idOf.get(node)) ? ICONS.folderOpen : ICONS.folderClosed;
  };

  const selectedNode = () => explorer.selectedEntry(index, state)?.node ?? null;

  const openSelectedInWindow = () => {
    const node = selectedNode();
    if (!explorer.isPdf(node)) return;
    const viewer = getWindow(VIEWER_ID);
    const frame = viewer.querySelector("[data-study-part='viewer-frame']");
    viewer.querySelector(".title-bar-text").textContent = node.name;
    frame.title = node.name;
    frame.dataset.src = explorer.pdfEmbedSrc(node);
    frame.removeAttribute("src");
    openWindow(VIEWER_ID);
    // openWindow only loads deferred media when the window was closed.
    if (!frame.getAttribute("src")) loadDeferredMedia(viewer);
  };

  const openSelectedInTab = () => {
    const node = selectedNode();
    if (!explorer.isFile(node)) return;
    window.open(node.href, "_blank", "noopener,noreferrer");
  };

  const downloadSelected = () => {
    const node = selectedNode();
    if (!explorer.isPdf(node)) return;
    const link = document.createElement("a");
    link.href = node.href;
    link.download = node.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  /** What a double click or Enter does to the selected entry. */
  const activateSelected = () => {
    const node = selectedNode();
    if (explorer.isFolder(node)) update(explorer.enterFolder(index, state, state.selectedId));
    else if (explorer.isPdf(node)) openSelectedInWindow();
    else if (explorer.isLink(node)) openSelectedInTab();
  };

  const renderTreeNode = (entry) => {
    const { node } = entry;
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "study-tree-row";
    const expanded = state.expandedIds.has(entry.id);

    if (explorer.isFolder(node)) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "study-tree-toggle";
      toggle.dataset.studyToggle = entry.id;
      toggle.setAttribute("aria-label", `${expanded ? "Close" : "Open"} ${node.name}`);
      toggle.textContent = expanded ? "-" : "+";
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "study-tree-toggle-spacer";
      row.appendChild(spacer);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "study-tree-item";
    button.dataset.studySelect = entry.id;
    button.setAttribute("aria-label", rowLabel(node));
    if (state.selectedId === entry.id) button.classList.add("is-selected");
    button.appendChild(createIcon(iconFor(node)));
    button.appendChild(createText("", node.name));
    button.appendChild(createText("study-tree-meta", `(${explorer.metadataText(node)})`));
    row.appendChild(button);
    item.appendChild(row);

    if (explorer.isFolder(node) && expanded && entry.children.length) {
      const childList = document.createElement("ul");
      for (const child of explorer.childEntries(index, entry)) childList.appendChild(renderTreeNode(child));
      item.appendChild(childList);
    }
    return item;
  };

  const renderTree = () => {
    const list = document.createElement("ul");
    list.className = "study-tree-list";
    list.appendChild(renderTreeNode(index.root));
    parts.tree.replaceChildren(list);
  };

  const renderFilePane = () => {
    const browse = explorer.browseEntry(index, state);
    const children = explorer.childEntries(index, browse);
    parts.filePane.classList.toggle("is-list", state.viewMode === "list");
    parts.filePane.classList.toggle("is-gallery", state.viewMode === "gallery");
    parts.currentTitle.textContent = browse.node.name;
    parts.itemCount.textContent = `${explorer.objectCountText(children.length)}, ${explorer.storageText(browse.node)}`;

    if (!children.length) {
      parts.filePane.replaceChildren(createEmpty("This folder is empty.", "study-empty"));
      return;
    }
    const fragment = document.createDocumentFragment();
    if (state.viewMode === "list") fragment.appendChild(createFileListHeader());
    for (const child of children) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "study-file-item";
      button.dataset.studyFile = child.id;
      button.setAttribute("aria-label", rowLabel(child.node));
      if (state.selectedId === child.id) button.classList.add("is-selected");
      button.appendChild(createIcon(iconFor(child.node)));
      button.appendChild(createText("study-file-name", child.node.name));
      button.appendChild(createText("study-file-type", explorer.typeText(child.node)));
      button.appendChild(createText("study-file-subitems", explorer.subitemText(child.node)));
      button.appendChild(createText("study-file-storage", explorer.storageText(child.node)));
      fragment.appendChild(button);
    }
    parts.filePane.replaceChildren(fragment);
  };

  const createDeferredFrame = (src, title) => {
    const iframe = document.createElement("iframe");
    iframe.dataset.src = src;
    iframe.setAttribute("data-unload-on-hide", "");
    iframe.title = title;
    return iframe;
  };

  const renderPdfPreview = (node) => {
    const wrapper = document.createElement("div");
    wrapper.className = "study-preview-pdf";
    const thumbnails = document.createElement("div");
    thumbnails.className = "study-pdf-thumbnails";
    thumbnails.setAttribute("aria-label", `${node.name} page thumbnails`);
    const main = document.createElement("div");
    main.className = "study-pdf-main";
    const mainFrame = createDeferredFrame(explorer.pdfEmbedSrc(node), node.name);
    main.appendChild(mainFrame);

    for (const [position, page] of explorer.thumbnailPages(node).entries()) {
      const thumbnail = document.createElement("div");
      thumbnail.className = "study-pdf-thumbnail";
      if (position === 0) thumbnail.classList.add("is-active");
      thumbnail.setAttribute("role", "button");
      thumbnail.setAttribute("tabindex", "0");
      thumbnail.setAttribute("aria-label", `Preview page ${page}`);
      thumbnail.dataset.studyPreviewPage = String(page);
      const frame = document.createElement("div");
      frame.className = "study-pdf-thumbnail-frame";
      const iframe = createDeferredFrame(explorer.pdfEmbedSrc(node, page, 55), `${node.name}, page ${page}`);
      iframe.setAttribute("tabindex", "-1");
      frame.appendChild(iframe);
      thumbnail.appendChild(frame);
      thumbnail.appendChild(createText("study-pdf-thumbnail-label", `Page ${page}`));
      thumbnails.appendChild(thumbnail);
    }

    const setPage = (thumbnail) => {
      const src = explorer.pdfEmbedSrc(node, Number(thumbnail.dataset.studyPreviewPage));
      mainFrame.dataset.src = src;
      mainFrame.src = src;
      thumbnails.querySelectorAll(".study-pdf-thumbnail").forEach((item) => {
        item.classList.toggle("is-active", item === thumbnail);
      });
    };
    thumbnails.addEventListener("click", (event) => {
      const thumbnail = event.target.closest("[data-study-preview-page]");
      if (thumbnail) setPage(thumbnail);
    });
    thumbnails.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const thumbnail = event.target.closest("[data-study-preview-page]");
      if (!thumbnail) return;
      event.preventDefault();
      setPage(thumbnail);
    });

    wrapper.append(thumbnails, main);
    return wrapper;
  };

  const renderLinkPreview = (node) => {
    const wrapper = document.createElement("div");
    wrapper.className = "study-preview-link";
    wrapper.appendChild(createIcon(ICONS.link));
    wrapper.appendChild(createText("study-preview-link-href", node.href));
    wrapper.appendChild(createText("study-preview-link-hint", "Opens in a new tab."));
    return wrapper;
  };

  const renderPreview = () => {
    const node = selectedNode();
    parts.previewIcon.src = node ? iconFor(node) : ICONS.folderOpen;
    parts.previewTitle.textContent = node ? node.name : ROOT_NAME;
    if (explorer.isPdf(node)) {
      parts.previewBody.replaceChildren(renderPdfPreview(node));
      if (isWindowOpen(ID)) loadDeferredMedia(parts.previewBody);
    } else if (explorer.isLink(node)) {
      parts.previewBody.replaceChildren(renderLinkPreview(node));
    } else {
      const message = explorer.subitemCount(node)
        ? "Select a folder, PDF or link to preview it here."
        : "No files are available in this folder yet.";
      parts.previewBody.replaceChildren(createEmpty(message, "study-preview-empty"));
    }
    buttons.openWindow.disabled = !explorer.isPdf(node);
    buttons.openTab.disabled = !explorer.isFile(node);
    buttons.download.disabled = !explorer.isPdf(node);
  };

  const renderStatus = () => {
    const selected = explorer.selectedEntry(index, state);
    const browse = explorer.browseEntry(index, state);
    const path = explorer.pathText(selected);
    parts.address.textContent = path;
    parts.statusLeft.textContent = `${explorer.objectCountText(browse.children.length)}, ${explorer.storageText(browse.node)}`;
    parts.statusRight.textContent = path;
    buttons.up.disabled = !explorer.canGoUp(index, state);
  };

  const renderViewButtons = () => {
    for (const [button, mode] of [[buttons.list, "list"], [buttons.gallery, "gallery"]]) {
      const isActive = state.viewMode === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  };

  const renderAll = () => {
    renderTree();
    renderFilePane();
    renderPreview();
    renderStatus();
    renderViewButtons();
  };

  function update(next) {
    if (next === state) return;
    state = next;
    renderAll();
  }

  /**
   * Re-renders replace the rows, so keyboard moves refocus the selected row;
   * when it left the pane (a folder was entered) the first row takes focus.
   */
  const focusSelected = (pane) => {
    const attribute = pane === parts.tree ? "data-study-select" : "data-study-file";
    const row = pane.querySelector(`[${attribute}="${state.selectedId}"]`) ?? pane.querySelector(`[${attribute}]`);
    row?.focus();
  };

  parts.tree.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-study-toggle]");
    if (toggle) {
      update(explorer.toggleFolder(index, state, toggle.dataset.studyToggle));
      return;
    }
    const item = event.target.closest("[data-study-select]");
    if (!item) return;
    const id = item.dataset.studySelect;
    update(event.detail > 1 ? explorer.enterFolder(index, state, id) : explorer.select(index, state, id));
  });
  parts.tree.addEventListener("dblclick", (event) => {
    const item = event.target.closest("[data-study-select]");
    if (item) update(explorer.enterFolder(index, state, item.dataset.studySelect));
  });

  const activateFile = (id) => {
    update(explorer.select(index, state, id));
    activateSelected();
  };
  // Selecting a folder re-renders the pane with its contents, so the second
  // click of a double click lands on a child row. The double click therefore
  // acts on the row the first click hit, not on whatever replaced it.
  let firstClickedId = null;
  parts.filePane.addEventListener("click", (event) => {
    const item = event.target.closest("[data-study-file]");
    if (event.detail > 1) {
      const id = firstClickedId ?? item?.dataset.studyFile;
      if (id) activateFile(id);
      return;
    }
    if (!item) return;
    firstClickedId = item.dataset.studyFile;
    update(explorer.select(index, state, firstClickedId));
  });
  parts.filePane.addEventListener("dblclick", (event) => {
    const id = firstClickedId ?? event.target.closest("[data-study-file]")?.dataset.studyFile;
    if (id) activateFile(id);
  });

  explorerRoot.addEventListener("keydown", (event) => {
    const inTree = parts.tree.contains(event.target);
    const inFiles = parts.filePane.contains(event.target);
    if (!inTree && !inFiles) return;
    const pane = inTree ? parts.tree : parts.filePane;
    const visibleIds = inTree ? explorer.visibleTreeIds(index, state) : explorer.filePaneIds(index, state);
    const selected = explorer.selectedEntry(index, state);
    const expanded = selected && state.expandedIds.has(selected.id) && selected.children.length > 0;
    let handled = true;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = explorer.stepId(visibleIds, state.selectedId, event.key === "ArrowDown" ? 1 : -1);
      if (next) update(explorer.select(index, state, next));
    } else if (event.key === "ArrowRight" && inTree) {
      update(explorer.expandFolder(index, state, state.selectedId, true));
    } else if (event.key === "ArrowLeft" && inTree) {
      update(expanded ? explorer.expandFolder(index, state, state.selectedId, false) : explorer.goUp(index, state));
    } else if (event.key === "Backspace") {
      update(explorer.goUp(index, state));
    } else if (event.key === "Enter" && inFiles && event.target.closest("[data-study-file]")) {
      activateFile(event.target.closest("[data-study-file]").dataset.studyFile);
    } else {
      handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    focusSelected(pane);
  });

  buttons.up.addEventListener("click", () => update(explorer.goUp(index, state)));
  buttons.list.addEventListener("click", () => update(explorer.setViewMode(state, "list")));
  buttons.gallery.addEventListener("click", () => update(explorer.setViewMode(state, "gallery")));
  buttons.openWindow.addEventListener("click", openSelectedInWindow);
  buttons.openTab.addEventListener("click", openSelectedInTab);
  buttons.download.addEventListener("click", downloadSelected);

  renderAll();
};

export default {
  id: ID,
  title: "Study Resources",
  icon: "assets/app-icons/ico/certificate_multiple.ico",
  styles: ["apps/study-resources/study-resources.css"],
  window: {
    className: "study-window",
    controls: ["minimize", "maximize", "close"],
  },
  render,
  mount,
  windows: [
    {
      id: VIEWER_ID,
      title: "Study Resource.pdf",
      window: { className: "study-pdf-window", controls: ["close"] },
      render: () => `
        <div class="study-pdf-viewer">
          <iframe data-study-part="viewer-frame" data-unload-on-hide title="Study resource PDF"></iframe>
        </div>`,
    },
  ],
};
