// Normalizes site.config.js so every other module can rely on complete,
// validated values. Unknown shapes throw at boot with a readable message.

const BACKGROUND_MODES = new Set(["image", "color", "time-of-day"]);
const DATE_KEY = /^(?:\d{4}-)?\d{2}-\d{2}$/;

const assertString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const normalizeBackground = (background = {}) => {
  const mode = background.mode ?? "image";
  if (!BACKGROUND_MODES.has(mode)) {
    throw new TypeError(`background.mode must be image, color or time-of-day (got ${mode})`);
  }
  const choices = (background.choices ?? []).map((choice, index) => ({
    label: assertString(choice.label, `background.choices[${index}].label`),
    image: choice.image ? assertString(choice.image, `background.choices[${index}].image`) : "",
    color: choice.color ? assertString(choice.color, `background.choices[${index}].color`) : "",
  }));
  const timeOfDay = background.timeOfDay ?? {};
  if (mode === "time-of-day") {
    for (const phase of ["sunrise", "day", "sunset", "night"]) {
      assertString(timeOfDay[phase], `background.timeOfDay.${phase}`);
    }
  }
  return Object.freeze({
    mode,
    image: background.image ? assertString(background.image, "background.image") : "",
    color: background.color ?? "#008080",
    timeOfDay: Object.freeze({ ...timeOfDay }),
    choices: Object.freeze(choices),
    allowCustom: background.allowCustom !== false,
  });
};

const normalizeCalendar = (calendar = {}) => {
  const photos = {};
  for (const [key, value] of Object.entries(calendar.photos ?? {})) {
    if (!DATE_KEY.test(key)) {
      throw new TypeError(`calendar.photos key "${key}" must be MM-DD or YYYY-MM-DD`);
    }
    const entry = typeof value === "string" ? { image: value } : value;
    photos[key] = Object.freeze({
      title: entry.title ?? "",
      image: assertString(entry.image, `calendar.photos["${key}"].image`),
      alt: entry.alt ?? entry.title ?? "",
    });
  }
  const quotes = {};
  for (const [month, quote] of Object.entries(calendar.quotes ?? {})) {
    quotes[Number(month)] = String(quote);
  }
  const monthBackgrounds = {};
  for (const [month, image] of Object.entries(calendar.monthBackgrounds ?? {})) {
    monthBackgrounds[Number(month)] = assertString(image, `calendar.monthBackgrounds[${month}]`);
  }
  return Object.freeze({
    enabled: calendar.enabled !== false,
    photos: Object.freeze(photos),
    quotes: Object.freeze(quotes),
    monthBackgrounds: Object.freeze(monthBackgrounds),
    clockScenes: Object.freeze({
      sunrise: "assets/backgrounds/sunrise.png",
      day: "assets/backgrounds/day.png",
      sunset: "assets/backgrounds/sunset.png",
      night: "assets/backgrounds/night.png",
      ...(calendar.clockScenes ?? {}),
    }),
  });
};

const normalizeCursor = (cursor = {}) =>
  Object.freeze({
    enabled: Boolean(cursor.enabled),
    defaultMode: cursor.defaultMode === "dark" ? "dark" : "light",
    packs: Object.freeze({
      light: cursor.packs?.light ?? "assets/cursors/light",
      dark: cursor.packs?.dark ?? "assets/cursors/dark",
    }),
  });

export const normalizeConfig = (config = {}) => {
  if (!config || typeof config !== "object") throw new TypeError("site.config.js must export an object");
  return Object.freeze({
    title: assertString(config.title ?? "My Desktop", "title"),
    awayTitle: typeof config.awayTitle === "string" ? config.awayTitle : "",
    startButtonLabel: config.startButtonLabel ?? "Start",
    storagePrefix: config.storagePrefix ?? "win98SiteKit",
    desktop: config.desktop ?? "*",
    dock: config.dock ?? "*",
    background: normalizeBackground(config.background),
    calendar: normalizeCalendar(config.calendar),
    cursor: normalizeCursor(config.cursor),
    clock: Object.freeze({ hour12: config.clock?.hour12 ?? true }),
  });
};
