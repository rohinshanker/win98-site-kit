// Tiny DOM builders so apps can render without a framework.

/** Parses an HTML string into a single element (the first top-level node). */
export const htmlToElement = (html) => {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
};

/** Parses an HTML string into a DocumentFragment (any number of nodes). */
export const htmlToFragment = (html) => {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content;
};

/**
 * Creates an element: `el("button", { class: "x", onClick: fn, "data-id": 1 }, "Label", child)`.
 * `on*` keys become listeners, `dataset`/`style` objects are applied, `hidden`
 * and `disabled` booleans are set as properties, everything else is an attribute.
 */
export const el = (tag, attributes = {}, ...children) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(element.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key === "hidden" || key === "disabled" || key === "checked") {
      element[key] = Boolean(value);
    } else if (key === "class") {
      element.className = value;
    } else {
      element.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
};

/** `querySelector` scoped to a root, defaulting to the document. */
export const one = (selector, root = document) => root.querySelector(selector);

/** `querySelectorAll` as an array. */
export const all = (selector, root = document) => [...root.querySelectorAll(selector)];
