// The app contract. Every folder under apps/ exports one of these from its
// index.js; kit/boot.js reads apps/installed.js to find them.
//
//   export default {
//     id: "about",                       // kebab-case, unique; used in data-app / data-app-window
//     title: "About Me",                 // title bar text and icon label
//     icon: "assets/app-icons/ico/help_book_big.ico",
//     label: "About",                    // optional shorter desktop label (defaults to title)
//     href: "https://…",                 // link app: opens a new tab instead of a window
//     styles: ["apps/about/about.css"],  // optional stylesheets injected at boot
//     window: {                          // omitted for link apps
//       width: 520,                      // CSS width in px, or a CSS length string
//       className: "about-window",       // extra classes on the .window element
//       controls: ["help", "minimize", "maximize", "close"],   // title-bar buttons, in order
//       center: true,                    // open centered instead of at a random spot
//       resizable: true,                 // corner drag resize (selector windows use it)
//       dialog: true,                    // role=dialog, Escape closes, focus returns to launcher
//       noDrag: false,                   // fixed position window
//     },
//     render: () => "<p>window body HTML</p>",   // string, Node, or DocumentFragment
//     mount(context) {},                 // once, after the window exists: { window, body, kit, app }
//     onOpen(win) {}, onOpened(win) {}, onClose(win) {}, onAlreadyOpen(win) {},
//     onResize(win) {},                  // viewport resized while the window is visible
//     onKeydown(event, win) {},          // keydown while the window is active; return true if handled
//     onLaunch(event) {},                // intercept the icon click; return true to skip opening
//     onTabChange(win) {},               // selector window tab switched
//     windows: [ { id, title, … } ],     // extra windows owned by this app (rules, dialogs)
//   }

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROLS = new Set(["help", "minimize", "maximize", "close"]);

const assertString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

export const normalizeWindowOptions = (options = {}, appId) => {
  const controls = options.controls ?? ["close"];
  if (!Array.isArray(controls) || controls.some((control) => !CONTROLS.has(control))) {
    throw new TypeError(`App ${appId} window.controls may only contain help, minimize, maximize, close`);
  }
  return Object.freeze({
    width: options.width ?? null,
    height: options.height ?? null,
    className: options.className ?? "",
    controls: Object.freeze([...controls]),
    center: Boolean(options.center),
    resizable: Boolean(options.resizable),
    dialog: Boolean(options.dialog),
    noDrag: Boolean(options.noDrag),
    bodyClassName: options.bodyClassName ?? "",
    bodyTabIndex: options.bodyTabIndex ?? null,
  });
};

/** Validates and freezes an app definition; throws with a clear message otherwise. */
export const normalizeApp = (definition) => {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("An app definition must be an object");
  }
  const id = assertString(definition.id, "App id");
  if (!ID_PATTERN.test(id)) throw new TypeError(`App id ${id} must be lowercase kebab-case`);
  const title = assertString(definition.title, `App ${id} title`);
  const icon = assertString(definition.icon, `App ${id} icon`);
  const styles = definition.styles ?? [];
  if (!Array.isArray(styles) || styles.some((style) => typeof style !== "string")) {
    throw new TypeError(`App ${id} styles must be an array of paths`);
  }
  const isLink = typeof definition.href === "string";
  const extraWindows = (definition.windows ?? []).map((extra) => {
    const extraId = assertString(extra.id, `App ${id} extra window id`);
    if (!ID_PATTERN.test(extraId)) {
      throw new TypeError(`App ${id} extra window id ${extraId} must be lowercase kebab-case`);
    }
    return Object.freeze({
      id: extraId,
      title: assertString(extra.title, `App ${id} window ${extraId} title`),
      window: normalizeWindowOptions(extra.window, extraId),
      render: extra.render ?? (() => ""),
      mount: extra.mount ?? null,
      hooks: pickHooks(extra),
    });
  });
  return Object.freeze({
    id,
    title,
    label: definition.label ? assertString(definition.label, `App ${id} label`) : title,
    icon,
    iconClassName: definition.iconClassName ?? "",
    description: definition.description ?? "",
    href: isLink ? definition.href : null,
    styles: Object.freeze([...styles]),
    window: isLink ? null : normalizeWindowOptions(definition.window, id),
    render: definition.render ?? (() => ""),
    mount: definition.mount ?? null,
    hooks: pickHooks(definition),
    windows: Object.freeze(extraWindows),
    isLink,
  });
};

const HOOK_NAMES = [
  "onOpen",
  "onOpened",
  "onClose",
  "onAlreadyOpen",
  "onResize",
  "onKeydown",
  "onLaunch",
  "onTabChange",
  "onDragEnd",
];

const pickHooks = (definition) =>
  Object.freeze(
    Object.fromEntries(
      HOOK_NAMES.filter((name) => typeof definition[name] === "function").map((name) => [
        name,
        definition[name],
      ])
    )
  );

/** Normalizes a list of app modules and rejects duplicate ids. */
export const normalizeApps = (definitions) => {
  const seen = new Set();
  return Object.freeze(
    definitions.map((definition) => {
      const app = normalizeApp(definition);
      if (seen.has(app.id)) throw new Error(`Duplicate app id ${app.id}`);
      seen.add(app.id);
      for (const extra of app.windows) {
        if (seen.has(extra.id)) throw new Error(`Duplicate window id ${extra.id}`);
        seen.add(extra.id);
      }
      return app;
    })
  );
};

/**
 * Expands a placement list such as `["about", "*", "credits"]` against the
 * installed app ids: `"*"` stands for every app not named elsewhere, in
 * installed order. Unknown ids throw so a typo is caught at boot.
 */
export const expandPlacement = (placement, installedIds, label) => {
  if (placement === "*" || placement === undefined) return [...installedIds];
  if (!Array.isArray(placement)) throw new TypeError(`${label} must be an array or "*"`);
  const named = placement.filter((id) => id !== "*");
  for (const id of named) {
    if (!installedIds.includes(id)) {
      throw new Error(`${label} names unknown app "${id}". Installed: ${installedIds.join(", ")}`);
    }
  }
  const remaining = installedIds.filter((id) => !named.includes(id));
  return placement.flatMap((id) => (id === "*" ? remaining : [id]));
};
