// Image / video carousel with Previous · counter · Next controls, lazy
// loading with an hourglass, neighbour preloading and optional captions.
//
//   createCarousel(container, items, { variant: "image" })
//
//   items: [{ src, alt, title, description, type: "image" | "video" }]  (a bare
//   string is an image src). Variants pick the frame height, see kit.css:
//   "image" (default), "video", "pdf", "poster", "photo" (aspect-ratio box).
//
// Spacing contract (kit.css): the frame has 6px sunken padding, the media
// slot a 2px inset on a white or black field, controls sit 8px below the
// slot, the frame itself 12px below preceding text. Buttons shrink to their
// icon label when the frame is narrower than 320px.

import { escapeHtml } from "./util.js";
import { isVideoSource, playMedia, preloadMediaSourcesInOrder, setLoading } from "./media.js";
import { onWindowOpen } from "./windows.js";

const VARIANTS = new Set(["image", "video", "pdf", "poster", "photo", "modeling"]);

const normalizeItem = (item, index) => {
  const entry = typeof item === "string" ? { src: item } : { ...item };
  if (!entry.src) throw new TypeError(`Carousel item ${index} needs a src`);
  entry.type = entry.type ?? (isVideoSource(entry.src) ? "video" : "image");
  entry.alt = entry.alt ?? entry.title ?? "";
  return entry;
};

const counterText = (index, total) => `${index + 1} of ${total}`;

const successors = (items, index) =>
  Array.from({ length: items.length - 1 }, (_, offset) => items[(index + offset + 1) % items.length].src);

const carouselsByContainer = new WeakMap();

/**
 * Builds a carousel inside `container` and returns its controller:
 * `{ go(index), next(), previous(), index, items, element, refresh() }`.
 * Media loads lazily the first time the carousel's window opens (or at once
 * when it is already visible), and the other items preload in order after it.
 */
export const createCarousel = (container, rawItems, options = {}) => {
  if (!container) throw new TypeError("createCarousel needs a container element");
  const variant = options.variant ?? "image";
  if (!VARIANTS.has(variant)) throw new TypeError(`Unknown carousel variant ${variant}`);
  const items = rawItems.map(normalizeItem);
  const showCaption = options.caption ?? items.some((item) => item.title || item.description);
  const autoplay = Boolean(options.autoplay);
  const ariaLabel = options.label ?? "Image carousel";

  container.classList.add("gallery-frame");
  container.innerHTML = `
    <div class="gallery-scroll gallery-scroll--${escapeHtml(variant)}"></div>
    <div class="gallery-controls">
      <button type="button" data-carousel-previous aria-label="Previous item" data-icon-label="‹">Previous</button>
      <span class="gallery-counter" aria-live="polite"></span>
      <button type="button" data-carousel-next aria-label="Next item" data-icon-label="›">Next</button>
    </div>
    ${showCaption ? '<p class="gallery-caption" aria-live="polite"></p><p class="gallery-description" aria-live="polite"></p>' : ""}`;
  container.setAttribute("role", "group");
  container.setAttribute("aria-roledescription", "carousel");
  container.setAttribute("aria-label", ariaLabel);

  const scroll = container.querySelector(".gallery-scroll");
  const previous = container.querySelector("[data-carousel-previous]");
  const next = container.querySelector("[data-carousel-next]");
  const counter = container.querySelector(".gallery-counter");
  const caption = container.querySelector(".gallery-caption");
  const description = container.querySelector(".gallery-description");
  let index = Math.min(Math.max(0, options.startIndex ?? 0), Math.max(0, items.length - 1));
  let activated = false;
  let loadToken = 0;
  let preloadToken = 0;

  const isVisible = () => {
    const win = container.closest(".window");
    return !win || (!win.classList.contains("is-hidden") && !win.classList.contains("is-closing"));
  };

  const render = () => {
    const item = items[index];
    scroll.querySelectorAll("img, video").forEach((media) => {
      if (media.matches("video")) media.pause();
      media.remove();
    });
    if (!item) {
      scroll.innerHTML = `<div class="gallery-empty">${escapeHtml(options.emptyText ?? "Nothing to show yet.")}</div>`;
      counter.textContent = "0 of 0";
      previous.disabled = true;
      next.disabled = true;
      return;
    }
    const token = (loadToken += 1);
    if (item.type === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("data-unload-on-hide", "");
      video.setAttribute("aria-label", item.title || `Video ${counterText(index, items.length)}`);
      if (autoplay) {
        video.muted = true;
        video.loop = true;
        video.setAttribute("data-autoplay-on-active", "");
      }
      setLoading(scroll, true);
      const finish = () => {
        if (token !== loadToken) return;
        setLoading(scroll, false);
      };
      video.addEventListener("loadeddata", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      video.src = item.src;
      scroll.prepend(video);
      if (autoplay) playMedia(video);
    } else {
      const image = document.createElement("img");
      image.alt = item.alt;
      image.decoding = "async";
      setLoading(scroll, true);
      const finish = () => {
        if (token !== loadToken) return;
        setLoading(scroll, false);
      };
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
      image.src = item.src;
      scroll.prepend(image);
      if (image.complete) queueMicrotask(finish);
    }
    counter.textContent = counterText(index, items.length);
    previous.disabled = items.length < 2;
    next.disabled = items.length < 2;
    if (caption) caption.textContent = item.title ?? "";
    if (description) description.textContent = item.description ?? "";
    options.onChange?.(index, item);

    const owned = (preloadToken += 1);
    void preloadMediaSourcesInOrder(successors(items, index), {
      shouldContinue: () => owned === preloadToken && isVisible(),
    });
  };

  const activate = () => {
    if (activated) return;
    activated = true;
    render();
  };

  const go = (nextIndex) => {
    if (!items.length) return;
    index = ((nextIndex % items.length) + items.length) % items.length;
    activated = true;
    render();
  };

  previous.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  container.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  });

  if (isVisible()) activate();
  const stopListening = onWindowOpen((win) => {
    if (win.contains(container)) activate();
  });

  const controller = Object.freeze({
    element: container,
    items,
    get index() {
      return index;
    },
    go,
    next: () => go(index + 1),
    previous: () => go(index - 1),
    refresh: render,
    destroy: () => {
      stopListening();
      carouselsByContainer.delete(container);
    },
  });
  carouselsByContainer.set(container, controller);
  return controller;
};

/** Returns the controller created for `container`, if any. */
export const carouselFor = (container) => carouselsByContainer.get(container) ?? null;

/**
 * Upgrades static markup: every `[data-carousel]` element whose JSON
 * attribute lists items becomes a carousel. Handy for apps written as HTML.
 *
 *   <div data-carousel='{"variant":"photo","items":["a.jpg","b.jpg"]}'></div>
 */
export const mountDeclaredCarousels = (root) => {
  root.querySelectorAll("[data-carousel]").forEach((container) => {
    if (carouselsByContainer.has(container)) return;
    let spec;
    try {
      spec = JSON.parse(container.getAttribute("data-carousel") || "{}");
    } catch (error) {
      throw new Error(`data-carousel must hold valid JSON: ${error.message}`);
    }
    const { items = [], ...options } = spec;
    createCarousel(container, items, options);
  });
};
