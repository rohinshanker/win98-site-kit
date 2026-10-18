// Desktop background: a fixed image, a solid color, or a time-of-day set.
// The visitor's choice from Display Properties persists in localStorage and
// wins over the config until they press "Use site default".

import { readJson, writeJson, remove } from "./storage.js";

let config = null;
let storageKey = "";
let timeOfDayTimer = 0;
const listeners = new Set();

const phaseForHour = (hour) => {
  if (hour >= 5 && hour < 7) return "sunrise";
  if (hour >= 7 && hour < 18) return "day";
  if (hour >= 18 && hour < 20) return "sunset";
  return "night";
};

/** The phase name for a date (sunrise 5–7, day 7–18, sunset 18–20, night otherwise). */
export const timeOfDayPhase = (date = new Date()) => phaseForHour(date.getHours());

const applyChoice = (choice) => {
  const root = document.documentElement;
  if (choice.image) {
    // Resolve against the page, not the stylesheet that declares the variable.
    const absolute = new URL(choice.image, document.baseURI).href;
    root.style.setProperty("--desktop-background-image", `url("${absolute}")`);
  } else {
    root.style.setProperty("--desktop-background-image", "none");
  }
  root.style.setProperty("--desktop-background-color", choice.color || config.color || "#008080");
  listeners.forEach((listener) => listener(choice));
};

const resolveConfigured = () => {
  if (config.mode === "color") return { label: "Site default", color: config.color, image: "" };
  if (config.mode === "time-of-day") {
    return { label: "Site default", image: config.timeOfDay[timeOfDayPhase()], color: config.color };
  }
  return { label: "Site default", image: config.image, color: config.color };
};

const scheduleTimeOfDay = () => {
  window.clearTimeout(timeOfDayTimer);
  if (config.mode !== "time-of-day" || readJson(storageKey)) return;
  const now = new Date();
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  timeOfDayTimer = window.setTimeout(() => {
    applyChoice(resolveConfigured());
    scheduleTimeOfDay();
  }, nextHour.getTime() - now.getTime() + 500);
};

/** Applies the saved choice or the configured default. boot.js calls this. */
export const initBackground = (backgroundConfig, prefix) => {
  config = backgroundConfig;
  storageKey = `${prefix}.background`;
  const saved = readJson(storageKey);
  applyChoice(saved && typeof saved === "object" ? saved : resolveConfigured());
  scheduleTimeOfDay();
};

/** The configured choices plus the site default, for Display Properties. */
export const backgroundChoices = () => [resolveConfigured(), ...config.choices];

/** Sets and persists a background `{ label, image, color }`. */
export const setBackground = (choice) => {
  const next = { label: choice.label ?? "Custom", image: choice.image ?? "", color: choice.color ?? "" };
  writeJson(storageKey, next);
  applyChoice(next);
  window.clearTimeout(timeOfDayTimer);
  return next;
};

/** Forgets the saved choice and returns to the configured default. */
export const resetBackground = () => {
  remove(storageKey);
  applyChoice(resolveConfigured());
  scheduleTimeOfDay();
};

export const getBackground = () => readJson(storageKey) ?? resolveConfigured();

export const onBackgroundChange = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
