// Components: the section catalogue. Each section is a live demo plus the
// exact snippet that reproduces it; HTML demos render the same string they
// show, so the sample can never drift from the demo. Pure strings, no DOM
// and no kit import, so node tests can render the catalogue directly.

export const EXTRA_WINDOW_ID = "components-extra";
export const ICON_PAGE_SIZE = 40;
export const SPACING_TOKENS = Object.freeze([
  { name: "--frame-padding", note: "sunken frame around media and panels" },
  { name: "--frame-inset", note: "white field inset inside a frame" },
  { name: "--window-gap", note: "between panels inside a window body" },
  { name: "--controls-gap", note: "between carousel buttons and the counter" },
]);

export const CAROUSEL_DEMOS = Object.freeze([
  {
    variant: "image",
    label: "Image carousel",
    note: "Default. Slot height 180–340px on a white field.",
    items: [
      { src: "assets/components/slide-wide.svg", title: "Slide one", description: "Captions are optional." },
      { src: "assets/projects/sample-1.svg", title: "Slide two" },
      { src: "assets/projects/sample-2.svg", title: "Slide three" },
    ],
  },
  {
    variant: "video",
    label: "Video carousel",
    note: "Black field, slot 220–440px. Items ending in .mp4 or .webm become <video>; images are allowed too, as here.",
    items: ["assets/components/slide-wide.svg", "assets/projects/sample-2.svg"],
  },
  {
    variant: "pdf",
    label: "PDF slides",
    note: "Taller slot (220–480px) for exported slides and figures.",
    items: [
      { src: "assets/projects/sample-1.svg", title: "Figure 1" },
      { src: "assets/components/slide-wide.svg", title: "Figure 2" },
    ],
  },
  {
    variant: "poster",
    label: "Poster",
    note: "Slot 220–460px for portrait posters.",
    items: [{ src: "assets/components/poster.svg", title: "Conference poster" }],
  },
  {
    variant: "photo",
    label: "Photo (aspect box)",
    note: "No fixed height: the slot keeps --gallery-aspect (3 / 4 here).",
    aspect: "3 / 4",
    items: [
      { src: "assets/components/portrait.svg", alt: "Portrait placeholder" },
      { src: "assets/about/photo-1.svg", alt: "Placeholder portrait one" },
      { src: "assets/about/photo-2.svg", alt: "Placeholder portrait two" },
    ],
  },
]);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const dedent = (text) => {
  const lines = text.replace(/^\n/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join("\n");
};

export const codeSample = (code, language = "html") =>
  `<pre class="code-sample" data-language="${escapeHtml(language)}" tabindex="0"><code>${escapeHtml(dedent(code))}</code></pre>`;

/** A live HTML demo followed by its own source. */
const htmlDemo = (caption, html) => {
  const markup = dedent(html);
  return `
    <section class="demo">
      <p class="demo-caption">${caption}</p>
      <div class="demo-stage">${markup}</div>
      ${codeSample(markup)}
    </section>`;
};

/** A live demo whose behaviour comes from JS: the stage and a JS sample. */
const scriptDemo = (caption, stageHtml, script, language = "js") => `
    <section class="demo">
      <p class="demo-caption">${caption}</p>
      <div class="demo-stage">${dedent(stageHtml)}</div>
      ${codeSample(script, language)}
    </section>`;

const header = (title, subtitle) => `
  <div class="view-header">
    <h3>${title}</h3>
    <p class="view-subtitle">${subtitle}</p>
  </div>`;

// ------------------------------------------------------------ 1. buttons

const buttonsHtml = `
  ${header("Buttons and inputs", "Plain 98.css markup. Copy the HTML as is.")}
  ${htmlDemo(
    "Buttons: normal, <code>class=\"default\"</code> for the one Enter would press, and <code>disabled</code>.",
    `
    <div class="field-row">
      <button type="button">Normal</button>
      <button type="button" class="default">Default</button>
      <button type="button" disabled>Disabled</button>
    </div>`
  )}
  ${htmlDemo(
    "Checkboxes need an <code>id</code> and a following <code>label</code>; the label draws the box.",
    `
    <div class="field-row">
      <input type="checkbox" id="components-check-on" checked />
      <label for="components-check-on">Checked</label>
    </div>
    <div class="field-row">
      <input type="checkbox" id="components-check-off" />
      <label for="components-check-off">Unchecked</label>
    </div>
    <div class="field-row">
      <input type="checkbox" id="components-check-disabled" disabled />
      <label for="components-check-disabled">Disabled</label>
    </div>`
  )}
  ${htmlDemo(
    "Radios share a <code>name</code>; a <code>fieldset</code> groups them.",
    `
    <fieldset>
      <legend>Startup</legend>
      <div class="field-row">
        <input type="radio" id="components-radio-normal" name="components-startup" checked />
        <label for="components-radio-normal">Normal</label>
      </div>
      <div class="field-row">
        <input type="radio" id="components-radio-safe" name="components-startup" />
        <label for="components-radio-safe">Safe mode</label>
      </div>
      <div class="field-row">
        <input type="radio" id="components-radio-dos" name="components-startup" disabled />
        <label for="components-radio-dos">MS-DOS prompt</label>
      </div>
    </fieldset>`
  )}
  ${htmlDemo(
    "<code>field-row</code> lays a label and control side by side; <code>field-row-stacked</code> stacks them.",
    `
    <div class="field-row">
      <label for="components-text">Name</label>
      <input id="components-text" type="text" value="Windows 98" />
    </div>
    <div class="field-row">
      <label for="components-select">Theme</label>
      <select id="components-select">
        <option>Windows Standard</option>
        <option>Brick</option>
        <option>Rainy Day</option>
      </select>
    </div>
    <div class="field-row">
      <label for="components-range">Low</label>
      <input id="components-range" type="range" min="1" max="11" value="5" />
      <label for="components-range">High</label>
    </div>
    <div class="field-row-stacked">
      <label for="components-textarea">Notes</label>
      <textarea id="components-textarea" rows="3">Stacked rows take the full width.</textarea>
    </div>`
  )}`;

// ------------------------------------------------------------- 2. panels

const TABS_SCRIPT = `
  // Switch aria-selected on the tab and show the matching panel.
  const tabs = root.querySelector("[data-tabs]");
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[role=tab]");
    if (!tab) return;
    event.preventDefault();
    tabs.querySelectorAll("[role=tab]").forEach((item) => {
      item.setAttribute("aria-selected", String(item === tab));
    });
    const target = tab.querySelector("a").getAttribute("href").slice(1);
    root.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== target;
    });
  });`;

const PROGRESS_SCRIPT = `
  // Drive the bar from any number 0–100.
  const bar = root.querySelector(".progress-indicator-bar");
  const meter = root.querySelector(".progress-indicator");
  const setProgress = (value) => {
    bar.style.width = \`\${value}%\`;
    meter.setAttribute("aria-valuenow", String(value));
  };
  root.querySelector("#components-progress").addEventListener("input", (event) => {
    setProgress(Number(event.target.value));
  });`;

const panelsHtml = `
  ${header("Panels", "Frames, group boxes, status bars, tabs, trees and progress bars.")}
  ${htmlDemo(
    "<code>sunken-panel</code>: a white recessed box that scrolls. Tables inside get the 98.css header look.",
    `
    <div class="sunken-panel" style="height: 96px;">
      <table class="interactive">
        <thead>
          <tr><th>Name</th><th>Size</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td>boot.js</td><td>4 KB</td><td>JavaScript</td></tr>
          <tr class="highlighted"><td>kit.css</td><td>18 KB</td><td>Stylesheet</td></tr>
          <tr><td>98.css</td><td>22 KB</td><td>Stylesheet</td></tr>
          <tr><td>site.config.js</td><td>2 KB</td><td>JavaScript</td></tr>
        </tbody>
      </table>
    </div>`
  )}
  ${htmlDemo(
    "<code>fieldset</code> + <code>legend</code> is the Windows group box.",
    `
    <fieldset>
      <legend>Group box</legend>
      <p>Anything goes inside: rows, text, other frames.</p>
    </fieldset>`
  )}
  ${htmlDemo(
    "<code>status-bar</code> fields grow evenly; put it last in the window body.",
    `
    <div class="status-bar">
      <p class="status-bar-field">Press F1 for help</p>
      <p class="status-bar-field">Slide 1</p>
      <p class="status-bar-field">CPU Usage: 14%</p>
    </div>`
  )}
  ${htmlDemo(
    "Tabs: a <code>menu[role=tablist]</code> above a <code>.window[role=tabpanel]</code>. The tab strip is static markup; the switching below is the JS sample that follows.",
    `
    <menu role="tablist" data-tabs>
      <li role="tab" aria-selected="true"><a href="#components-tab-desktop">Desktop</a></li>
      <li role="tab" aria-selected="false"><a href="#components-tab-saver">Screen Saver</a></li>
      <li role="tab" aria-selected="false"><a href="#components-tab-settings">Settings</a></li>
    </menu>
    <div class="window" role="tabpanel">
      <div class="window-body">
        <p data-tab-panel="components-tab-desktop">Wallpaper and pattern options live here.</p>
        <p data-tab-panel="components-tab-saver" hidden>Flying Windows, 3D Pipes, Mystify.</p>
        <p data-tab-panel="components-tab-settings" hidden>640 by 480 pixels, 256 colors.</p>
      </div>
    </div>`
  )}
  ${codeSample(TABS_SCRIPT, "js")}
  ${htmlDemo(
    "<code>ul.tree-view</code> with <code>details</code>/<code>summary</code> for collapsible branches.",
    `
    <ul class="tree-view">
      <li>
        <details open>
          <summary>My Computer</summary>
          <ul>
            <li>3½ Floppy (A:)</li>
            <li>
              <details>
                <summary>Local Disk (C:)</summary>
                <ul>
                  <li>Program Files</li>
                  <li>Windows</li>
                </ul>
              </details>
            </li>
            <li>CD-ROM (D:)</li>
          </ul>
        </details>
      </li>
      <li>Network Neighborhood</li>
      <li>Recycle Bin</li>
    </ul>`
  )}
  ${scriptDemo(
    "Progress indicator: a <code>.progress-indicator</code> whose bar width is the percentage. Add <code>segmented</code> for the blocky style. Move the slider to drive the first bar.",
    `
    <div class="field-row">
      <label for="components-progress">Progress</label>
      <input id="components-progress" type="range" min="0" max="100" value="60" />
    </div>
    <div class="progress-indicator" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60">
      <span class="progress-indicator-bar" style="width: 60%;"></span>
    </div>
    <div class="progress-indicator segmented" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
      <span class="progress-indicator-bar"></span>
    </div>`,
    `${dedent(`
    <div class="progress-indicator" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60">
      <span class="progress-indicator-bar" style="width: 60%;"></span>
    </div>
    <div class="progress-indicator segmented"><span class="progress-indicator-bar"></span></div>`)}\n\n${dedent(PROGRESS_SCRIPT)}`,
    "html+js"
  )}`;

// ---------------------------------------------------------- 3. carousels

const carouselItemLiteral = (item) =>
  typeof item === "string"
    ? `"${item}"`
    : `{ ${Object.entries(item)
        .map(([key, value]) => `${key}: "${value}"`)
        .join(", ")} }`;

export const carouselSnippet = (demo) => `
  import { createCarousel } from "../../kit/index.js";

  const container = win.querySelector('[data-carousel="${demo.variant}"]');${
    demo.aspect ? `\n  container.style.setProperty("--gallery-aspect", "${demo.aspect}");` : ""
  }
  createCarousel(container, [
  ${demo.items.map((item) => `  ${carouselItemLiteral(item)},`).join("\n  ")}
  ], { variant: "${demo.variant}", label: "${demo.label}" });`;

const carouselsHtml = `
  ${header("Carousels", "createCarousel(container, items, { variant }) — one of each variant.")}
  <p class="demo-caption">Items are <code>{ src, alt, title, description, type }</code> or a bare src string. A src ending in <code>.mp4</code>/<code>.webm</code> becomes a <code>&lt;video&gt;</code>; everything else an <code>&lt;img&gt;</code>. Media loads lazily when the window first opens and the other items preload in order. Arrow keys work when the frame has focus.</p>
  <div class="demo-carousels">
    ${CAROUSEL_DEMOS.map(
      (demo) => `
    <section class="demo">
      <p class="demo-caption"><strong>${escapeHtml(demo.variant)}</strong> — ${escapeHtml(demo.note)}</p>
      <div class="demo-stage demo-stage--flush">
        <div data-carousel="${escapeHtml(demo.variant)}" tabindex="0"></div>
      </div>
      ${codeSample(carouselSnippet(demo), "js")}
    </section>`
    ).join("")}
  </div>`;

// ------------------------------------------------------------- 4. alerts

export const ALERT_SNIPPET = `
  import { showAlert } from "../../kit/index.js";

  // One button: resolves "ok" (or "dismiss" on Escape / title-bar close).
  const pressed = await showAlert({
    title: "System Alert",
    icon: "assets/app-icons/ico/msg_information.ico",
    body: "<p>Settings were saved.</p>",
    buttons: ["OK"],
  });

  // Three buttons: ids come from the labels unless you set them.
  const answer = await showAlert({
    title: "Notepad",
    icon: "assets/app-icons/ico/msg_question.ico",
    body: "<p>The text in Untitled has changed.</p><p>Do you want to save the changes?</p>",
    buttons: [{ id: "yes", label: "Yes", primary: true }, "No", "Cancel"],
    buttonAlignment: "center", // "left" | "center" | "right" (default)
  });

  // Image alert: a framed picture under the message.
  await showAlert({
    title: "Picture",
    icon: "assets/app-icons/ico/msg_warning.ico",
    body: "<p>Alerts can carry an image.</p>",
    image: { src: "assets/components/slide-wide.svg", alt: "A slide" },
    width: 420,
  });`;

const alertsHtml = `
  ${header("Alerts", "showAlert({ title, icon, body, buttons, image }) resolves with the pressed button id.")}
  ${scriptDemo(
    "Press a button to open the alert; the status bar shows what <code>showAlert</code> resolved with. <code>body</code> is trusted HTML: wrap user text in <code>escapeHtml</code>.",
    `
    <div class="action-row">
      <button type="button" data-alert="one">One button</button>
      <button type="button" data-alert="three">Three buttons</button>
      <button type="button" data-alert="image">Image alert</button>
    </div>
    <fieldset>
      <legend>Button alignment (three buttons)</legend>
      <div class="field-row">
        <input type="radio" id="components-align-left" name="components-align" value="left" />
        <label for="components-align-left">Left</label>
        <input type="radio" id="components-align-center" name="components-align" value="center" />
        <label for="components-align-center">Center</label>
        <input type="radio" id="components-align-right" name="components-align" value="right" checked />
        <label for="components-align-right">Right</label>
      </div>
    </fieldset>
    <div class="status-bar">
      <p class="status-bar-field" data-alert-result aria-live="polite">No alert shown yet.</p>
    </div>`,
    ALERT_SNIPPET
  )}`;

// ------------------------------------------------------------ 5. windows

export const WINDOW_SNIPPET = `
  // apps/my-app/index.js
  import { closeWindow, openWindow } from "../../kit/index.js";

  export default {
    id: "my-app",
    title: "My App",
    icon: "assets/app-icons/ico/notepad.ico",
    window: {
      width: 420,                                    // px or any CSS length
      className: "selector-window",                  // extra classes on .window
      controls: ["minimize", "maximize", "close"],   // title-bar buttons, in order
      center: false,                                 // true: open centred (dialogs)
      resizable: true,                               // corner drag; adds is-window-narrow/short
      dialog: false,                                 // role=dialog, Escape closes, focus returns
    },
    render: () => \`<button type="button" data-open-extra>Open extra window</button>\`,
    mount({ window: win }) {
      win.querySelector("[data-open-extra]").addEventListener("click", () => openWindow("my-app-extra"));
    },
    windows: [
      {
        id: "my-app-extra",
        title: "Extra window",
        window: { width: 320, controls: ["close"], center: true, dialog: true },
        render: () => \`<p>Owned by my-app.</p><button type="button" data-close-extra>Close</button>\`,
        mount({ window: win }) {
          win.querySelector("[data-close-extra]").addEventListener("click", () => closeWindow("my-app-extra"));
        },
      },
    ],
  };`;

export const LINK_APP_SNIPPET = `
  // apps/repo/index.js — a link app has no window; its icon opens a new tab.
  export default {
    id: "repo",
    title: "Source code",
    icon: "assets/app-icons/ico/windows_update_large.ico",
    href: "https://github.com/rohinshanker/win98-site-kit",
  };`;

const windowsHtml = `
  ${header("Windows", "Window options, extra windows and link apps.")}
  <table class="option-table">
    <thead><tr><th>Option</th><th>Default</th><th>Effect</th></tr></thead>
    <tbody>
      <tr><td><code>controls</code></td><td><code>["close"]</code></td><td>Title-bar buttons: <code>help</code>, <code>minimize</code>, <code>maximize</code>, <code>close</code>. Minimize closes; maximize fills the viewport.</td></tr>
      <tr><td><code>center</code></td><td><code>false</code></td><td>Open centred instead of at a random spot; tall windows pin to the top.</td></tr>
      <tr><td><code>dialog</code></td><td><code>false</code></td><td><code>role=dialog</code>; Escape closes it and focus returns to the launcher.</td></tr>
      <tr><td><code>resizable</code></td><td><code>false</code></td><td>Drag the bottom-right corner; the kit toggles <code>is-window-narrow</code> (&lt;540px) and <code>is-window-short</code> (&lt;360px).</td></tr>
      <tr><td><code>width</code> / <code>height</code></td><td>CSS</td><td>Number in px or a CSS length. Prefer <code>min(…, calc(100vw - 24px))</code> in CSS for small screens.</td></tr>
      <tr><td><code>noDrag</code></td><td><code>false</code></td><td>Fixed position; the title bar stops dragging.</td></tr>
    </tbody>
  </table>
  ${scriptDemo(
    "This button opens a window declared in this app's <code>windows: [...]</code>; it is centred, a dialog (Escape closes it) and 320px wide.",
    `
    <div class="action-row">
      <button type="button" data-open-window="${EXTRA_WINDOW_ID}">Open extra window</button>
      <a class="button-link" href="https://github.com/rohinshanker/win98-site-kit" target="_blank" rel="noreferrer">Link (new tab)</a>
    </div>
    <div class="status-bar">
      <p class="status-bar-field" data-window-state aria-live="polite">Extra window: closed</p>
    </div>`,
    WINDOW_SNIPPET
  )}
  <section class="demo">
    <p class="demo-caption">A link app is the same shape without a window; <code>button-link</code> anchors (above) are the in-window equivalent.</p>
    ${codeSample(LINK_APP_SNIPPET, "js")}
  </section>`;

// -------------------------------------------------------------- 6. icons

export const ICON_SNIPPET = `
  <!-- In markup: -->
  <img src="assets/app-icons/ico/notepad.ico" width="32" height="32" alt="" />

  // In an app definition:
  icon: "assets/app-icons/ico/notepad.ico",`;

const iconsHtml = `
  ${header("Icon browser", "All 626 icons under assets/app-icons/ico/. Click one to copy its path.")}
  <div class="field-row icon-search-row">
    <label for="components-icon-search">Search</label>
    <input id="components-icon-search" type="search" placeholder="notepad, folder, msg_…" autocomplete="off" />
  </div>
  <div class="status-bar">
    <p class="status-bar-field" data-icon-status aria-live="polite">Loading icons…</p>
  </div>
  <div class="icon-grid" data-icon-grid role="list" aria-label="Icons"></div>
  <div class="icon-pager">
    <button type="button" data-icon-prev aria-label="Previous page" data-icon-label="‹">Previous</button>
    <span class="gallery-counter" data-icon-page aria-live="polite">0 of 0</span>
    <button type="button" data-icon-next aria-label="Next page" data-icon-label="›">Next</button>
  </div>
  <div class="field-row icon-path-row">
    <label for="components-icon-path">Path</label>
    <input id="components-icon-path" type="text" readonly value="" aria-describedby="components-icon-copy-note" />
  </div>
  <p class="demo-caption" id="components-icon-copy-note" data-icon-copy-note>Click an icon to put its path here; it is copied to the clipboard when the browser allows it.</p>
  ${codeSample(ICON_SNIPPET)}`;

// ------------------------------------------------------------ 7. spacing

export const SPACING_SNIPPET = `
  /* Spacing tokens on :root (template/styles/kit.css). Reuse them, never hard-code. */
  .my-frame    { padding: var(--frame-padding); background: var(--surface);
                 box-shadow: var(--border-sunken-outer), var(--border-sunken-inner); }
  .my-slot     { padding: var(--frame-inset); background: #fff; box-shadow: var(--border-field); }
  .my-controls { margin-top: var(--controls-gap); display: flex; gap: var(--controls-gap); }
  .my-body     { display: grid; gap: var(--window-gap); }`;

const spacingHtml = `
  ${header("Spacing tokens", "Values read from getComputedStyle(document.documentElement) at mount.")}
  <dl class="token-list">
    ${SPACING_TOKENS.map(
      (token) => `
    <div class="token-row">
      <dt><code>${escapeHtml(token.name)}</code></dt>
      <dd>
        <span class="token-bar" style="width: var(${escapeHtml(token.name)});" aria-hidden="true"></span>
        <strong data-token="${escapeHtml(token.name)}">…</strong>
        <span class="token-note">${escapeHtml(token.note)}</span>
      </dd>
    </div>`
    ).join("")}
  </dl>
  <section class="demo">
    <p class="demo-caption">Where each token sits in a media frame: yellow is <code>--frame-padding</code>, blue is <code>--frame-inset</code>, green is <code>--controls-gap</code>, red is <code>--window-gap</code>.</p>
    <div class="demo-stage">
      <div class="token-diagram">
        <div class="token-diagram-panel">
          <div class="token-diagram-frame">
            <div class="token-diagram-slot"><div class="token-diagram-media">media slot</div></div>
          </div>
          <div class="token-diagram-controls-gap"></div>
          <div class="token-diagram-controls"><span>Previous</span><span>1 of 3</span><span>Next</span></div>
        </div>
        <div class="token-diagram-window-gap"></div>
        <div class="token-diagram-panel token-diagram-panel--text">second panel</div>
      </div>
    </div>
    ${codeSample(SPACING_SNIPPET, "css")}
  </section>`;

export const SECTIONS = Object.freeze([
  {
    id: "buttons",
    title: "Buttons and inputs",
    description: "Buttons, checkboxes, radios, text, select, range, textarea",
    icon: "assets/app-icons/ico/windows_button.ico",
    html: buttonsHtml,
  },
  {
    id: "panels",
    title: "Panels",
    description: "Sunken panel, group box, status bar, tabs, tree, progress",
    icon: "assets/app-icons/ico/shell_window2.ico",
    html: panelsHtml,
  },
  {
    id: "carousels",
    title: "Carousels",
    description: "image, video, pdf, poster, photo",
    icon: "assets/app-icons/ico/paint_window.ico",
    html: carouselsHtml,
  },
  {
    id: "alerts",
    title: "Alerts",
    description: "showAlert with one, three or image buttons",
    icon: "assets/app-icons/ico/msg_warning.ico",
    html: alertsHtml,
  },
  {
    id: "windows",
    title: "Windows",
    description: "Options, extra windows, link apps",
    icon: "assets/app-icons/ico/windows_three.ico",
    html: windowsHtml,
  },
  {
    id: "icons",
    title: "Icon browser",
    description: "Search 626 icons and copy a path",
    icon: "assets/app-icons/ico/directory_open_cool.ico",
    html: iconsHtml,
  },
  {
    id: "spacing",
    title: "Spacing tokens",
    description: "--frame-padding, --frame-inset, --window-gap, --controls-gap",
    icon: "assets/app-icons/ico/settings_gear.ico",
    html: spacingHtml,
  },
]);

export const SECTION_IDS = Object.freeze(SECTIONS.map((section) => section.id));
