// Icon browser helpers: filtering the icon manifest and slicing it into
// pages. Pure functions with no DOM so node tests can exercise them.

/**
 * Keeps the names that contain every whitespace-separated word of `query`
 * (case-insensitive). An empty query keeps everything; order is preserved.
 */
export const filterIcons = (names, query) => {
  const words = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [...names];
  return names.filter((name) => {
    const haystack = String(name).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};

/**
 * Slices `list` into page `page` (0-based) of `size` items. The page index
 * is clamped into range so a stale page after a narrower search still
 * returns the last page instead of nothing.
 *
 *   paginate(["a", "b", "c"], 1, 2)
 *   → { items: ["c"], page: 1, pageCount: 2, total: 3, start: 2, end: 3 }
 */
export const paginate = (list, page, size) => {
  const pageSize = Math.max(1, Math.floor(Number(size) || 1));
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  const start = Math.min(safePage * pageSize, total);
  const end = Math.min(start + pageSize, total);
  return { items: list.slice(start, end), page: safePage, pageCount, total, start, end };
};
