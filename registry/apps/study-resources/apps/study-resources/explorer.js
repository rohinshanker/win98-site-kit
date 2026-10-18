// Pure Study Resources explorer logic: validates the resource tree, indexes
// it by id, formats path, count and size text, and moves the selection. No
// DOM and no window object, so node tests import it directly.

export const ROOT_ID = "study-resources";
export const DEFAULT_ROOT_NAME = "Study Resources";
export const VIEW_MODES = Object.freeze(["list", "gallery"]);
const NODE_TYPES = new Set(["folder", "pdf", "link"]);
const MAX_THUMBNAILS = 3;

export const isFolder = (node) => Boolean(node) && node.type === "folder";
export const isPdf = (node) => Boolean(node) && node.type === "pdf";
export const isLink = (node) => Boolean(node) && node.type === "link";
export const isFile = (node) => isPdf(node) || isLink(node);

export const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const fail = (trail, message) => {
  throw new TypeError(`Study resource ${trail.join(" > ") || "(root)"}: ${message}`);
};

/** Throws a TypeError naming the offending entry when the tree is malformed. */
export const validateResources = (resources, trail = []) => {
  if (!Array.isArray(resources)) fail(trail, "children must be an array");
  resources.forEach((node, position) => {
    const name = node && typeof node.name === "string" ? node.name : `#${position + 1}`;
    const nodeTrail = [...trail, name];
    if (!node || typeof node !== "object") fail(nodeTrail, "must be an object");
    if (typeof node.name !== "string" || !node.name.trim()) fail(nodeTrail, "name must be a non-empty string");
    if (!NODE_TYPES.has(node.type)) fail(nodeTrail, 'type must be "folder", "pdf" or "link"');
    if (isFolder(node)) {
      validateResources(node.children ?? [], nodeTrail);
      return;
    }
    if (typeof node.href !== "string" || !node.href.trim()) fail(nodeTrail, "href must be a non-empty string");
    if (node.size !== undefined && (!Number.isFinite(node.size) || node.size < 0)) {
      fail(nodeTrail, "size must be a non-negative number of bytes");
    }
    if (node.pages !== undefined && (!Number.isInteger(node.pages) || node.pages < 1)) {
      fail(nodeTrail, "pages must be a positive integer");
    }
  });
  return resources;
};

/**
 * Indexes a resource tree under a synthetic root folder. Returns
 * `{ root, entries }`: `entries` maps every id to
 * `{ id, node, parentId, path, children }`, where `path` lists the names
 * from the root down and `children` the ordered child ids. Ids are slugs
 * of the path below the root (`course-notes-sample-notes-pdf`), made unique
 * with a numeric suffix when two entries would collide.
 */
export const createIndex = (resources, rootName = DEFAULT_ROOT_NAME) => {
  validateResources(resources);
  const entries = new Map();
  const uniqueId = (base) => {
    let id = base;
    let suffix = 2;
    while (entries.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  };
  const add = (node, id, parentId, path) => {
    const entry = { id, node, parentId, path, children: [] };
    entries.set(id, entry);
    const children = isFolder(node) ? node.children ?? [] : [];
    for (const child of children) {
      const childPath = [...path, child.name];
      const childId = uniqueId(slug(childPath.slice(1).join(" ")));
      entry.children.push(add(child, childId, id, childPath).id);
    }
    Object.freeze(entry.children);
    return Object.freeze(entry);
  };
  const root = add({ type: "folder", name: rootName, children: resources }, ROOT_ID, null, [rootName]);
  return Object.freeze({ root, entries });
};

export const getEntry = (index, id) => index.entries.get(id) ?? null;

export const parentEntry = (index, entry) => (entry && entry.parentId ? getEntry(index, entry.parentId) : null);

export const childEntries = (index, entry) => (entry ? entry.children.map((id) => getEntry(index, id)) : []);

export const pathText = (entry) => (entry ? entry.path.join("\\") : "");

export const objectCountText = (count) => `${count} object${count === 1 ? "" : "s"}`;

export const subitemCount = (node) => (isFolder(node) ? (node.children ?? []).length : 0);

export const subitemText = (node) => {
  const count = subitemCount(node);
  return `${count} item${count === 1 ? "" : "s"}`;
};

export const storageBytes = (node) => {
  if (!node) return 0;
  if (isFolder(node)) return (node.children ?? []).reduce((total, child) => total + storageBytes(child), 0);
  return Number(node.size) || 0;
};

export const formatStorage = (bytes) => {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
};

export const storageText = (node) => formatStorage(storageBytes(node));

export const metadataText = (node) => `${subitemText(node)}, ${storageText(node)}`;

export const typeText = (node) => {
  if (isPdf(node)) return "PDF Document";
  if (isLink(node)) return "Internet Shortcut";
  return "File Folder";
};

/** The iframe URL for a PDF page: the browser viewer with its chrome hidden. */
export const pdfEmbedSrc = (node, page = 1, zoom = 100) =>
  isPdf(node) && node.href ? `${node.href}#page=${page}&zoom=${zoom}&toolbar=0&navpanes=0` : "";

/** Page numbers the preview shows as thumbnails: up to three, capped by `pages`. */
export const thumbnailPages = (node) => {
  const pages = Number.isInteger(node?.pages) ? node.pages : MAX_THUMBNAILS;
  return Array.from({ length: Math.min(MAX_THUMBNAILS, Math.max(1, pages)) }, (_, offset) => offset + 1);
};

/** Explorer state: the selected id, the expanded folder ids and the view mode. */
export const createState = (index) =>
  Object.freeze({
    selectedId: index.root.id,
    expandedIds: Object.freeze(new Set([index.root.id])),
    viewMode: "list",
  });

const withState = (state, patch) => Object.freeze({ ...state, ...patch });

export const selectedEntry = (index, state) => getEntry(index, state.selectedId);

/** The folder whose contents the file pane shows: the selection or its parent. */
export const browseEntry = (index, state) => {
  const selected = selectedEntry(index, state);
  if (selected && isFolder(selected.node)) return selected;
  return parentEntry(index, selected) ?? index.root;
};

export const select = (index, state, id) => (getEntry(index, id) ? withState(state, { selectedId: id }) : state);

export const expandFolder = (index, state, id, open = true) => {
  const entry = getEntry(index, id);
  if (!entry || !isFolder(entry.node)) return state;
  const expandedIds = new Set(state.expandedIds);
  if (open) expandedIds.add(id);
  else expandedIds.delete(id);
  return withState(state, { expandedIds: Object.freeze(expandedIds) });
};

export const toggleFolder = (index, state, id) => expandFolder(index, state, id, !state.expandedIds.has(id));

/** Selects and expands a folder, as a double click or Enter does. */
export const enterFolder = (index, state, id) => {
  const entry = getEntry(index, id);
  if (!entry || !isFolder(entry.node)) return state;
  return select(index, expandFolder(index, state, id, true), id);
};

export const canGoUp = (index, state) => Boolean(selectedEntry(index, state)?.parentId);

export const goUp = (index, state) => {
  const parent = parentEntry(index, selectedEntry(index, state));
  return parent ? select(index, state, parent.id) : state;
};

export const setViewMode = (state, viewMode) => {
  if (!VIEW_MODES.includes(viewMode)) throw new TypeError(`Unknown view mode "${viewMode}"`);
  return withState(state, { viewMode });
};

/** Ids of the tree rows a user can see, top to bottom (expanded folders only). */
export const visibleTreeIds = (index, state, entry = index.root) => {
  const expanded = isFolder(entry.node) && state.expandedIds.has(entry.id);
  const below = expanded ? entry.children.flatMap((id) => visibleTreeIds(index, state, getEntry(index, id))) : [];
  return [entry.id, ...below];
};

/** Ids shown in the file pane: the children of the browsed folder. */
export const filePaneIds = (index, state) => [...browseEntry(index, state).children];

/**
 * The id `delta` steps away from `currentId` within `ids`, clamped to the
 * ends; the first id when the current one is not listed, null when empty.
 */
export const stepId = (ids, currentId, delta) => {
  if (!ids.length) return null;
  const position = ids.indexOf(currentId);
  if (position === -1) return ids[0];
  return ids[Math.max(0, Math.min(ids.length - 1, position + delta))];
};
