// Media helpers: deferred `data-src` loading when a window first opens, an
// hourglass loading indicator, image-to-frame fitting and playback control.

const LOADING_ASSET = "assets/windows98-hourglass-2x.gif";

export const isVideoSource = (source) => /\.(mp4|webm|ogg)(?:[?#]|$)/i.test(String(source));

/** Shows or hides an hourglass overlay inside `slot` (which must be positioned). */
export const setLoading = (slot, isLoading, { className = "media-loading" } = {}) => {
  if (!slot) return;
  let indicator = slot.querySelector(`:scope > .${className}`);
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = className;
    indicator.setAttribute("aria-hidden", "true");
    const image = document.createElement("img");
    image.className = `${className}__image`;
    image.alt = "";
    image.decoding = "async";
    image.src = LOADING_ASSET;
    indicator.appendChild(image);
    slot.appendChild(indicator);
  }
  indicator.hidden = !isLoading;
  if (isLoading) slot.setAttribute("aria-busy", "true");
  else slot.removeAttribute("aria-busy");
};

const fitImageIntoFrame = (image) => {
  const frame = image.closest("[data-fit-image-frame]");
  if (!frame) return;
  const applyImageFit = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    frame.style.setProperty("--image-fit-aspect", `${image.naturalWidth} / ${image.naturalHeight}`);
  };
  if (image.dataset.fitImageFrameBound !== "true") {
    image.addEventListener("load", applyImageFit);
    image.dataset.fitImageFrameBound = "true";
  }
  if (image.complete) applyImageFit();
};

/** Gives every `[data-fit-image-frame]` its image's aspect ratio as a CSS variable. */
export const fitImagesIntoFrames = (root = document) => {
  root.querySelectorAll("[data-fit-image-frame] img").forEach(fitImageIntoFrame);
};

/**
 * Loads every `[data-src]` image, video, audio, source and iframe under `root`.
 * Elements inside hidden selector tabs (`.viewer-content.is-hidden`) wait
 * until their tab is shown unless `includeHidden` is set.
 */
export const loadDeferredMedia = (root, { includeHidden = false } = {}) => {
  if (!root) return [];
  const loaded = [];
  root.querySelectorAll("[data-src]").forEach((element) => {
    if (!includeHidden && element.closest(".viewer-content.is-hidden")) return;
    if (element.getAttribute("src")) return;
    element.setAttribute("src", element.dataset.src);
    if (element.matches("img")) fitImageIntoFrame(element);
    if (element.matches("source")) {
      const owner = element.closest("video, audio");
      if (owner && !owner.querySelector("source[data-src]:not([src])")) owner.load();
    } else if (element.matches("video, audio")) {
      element.load();
    }
    loaded.push(element);
  });
  return loaded;
};

/** Pauses playing media under `root` without unloading it. */
export const pauseMedia = (root) => {
  if (!root) return;
  root.querySelectorAll("video, audio").forEach((media) => media.pause());
};

/**
 * Pauses media under `root` and unloads anything marked
 * `data-unload-on-hide` so a closed window stops buffering.
 */
export const stopMedia = (root) => {
  if (!root) return;
  root.querySelectorAll("video, audio").forEach((media) => {
    media.pause();
    if (!media.matches("[data-unload-on-hide]")) return;
    const src = media.getAttribute("src");
    if (src) media.dataset.src = src;
    media.removeAttribute("src");
    media.load();
  });
  root.querySelectorAll("iframe[data-unload-on-hide]").forEach((iframe) => {
    const src = iframe.getAttribute("src");
    if (src) iframe.dataset.src = src;
    iframe.removeAttribute("src");
  });
};

/** Plays a media element, ignoring autoplay refusals. */
export const playMedia = (media) => {
  if (!media) return;
  if (!media.getAttribute("src") && media.dataset.src) {
    media.setAttribute("src", media.dataset.src);
    media.load();
  }
  const request = media.play();
  if (request && typeof request.catch === "function") request.catch(() => {});
};

const preloadRequests = new Map();

/** Warms the browser cache for an image or video URL; resolves on load or error. */
export const preloadMediaSource = (source) => {
  if (!source) return Promise.resolve();
  if (preloadRequests.has(source)) return preloadRequests.get(source);
  const request = new Promise((resolve) => {
    if (isVideoSource(source)) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      const finish = () => resolve();
      video.addEventListener("loadedmetadata", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      video.src = source;
    } else {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
      image.src = source;
    }
  });
  preloadRequests.set(source, request);
  return request;
};

/** Preloads sources one after another while `shouldContinue()` stays true. */
export const preloadMediaSourcesInOrder = (sources, { shouldContinue = () => true } = {}) =>
  sources.reduce(
    (queue, source) =>
      queue.then(() => (shouldContinue() ? preloadMediaSource(source) : undefined)),
    Promise.resolve()
  );
