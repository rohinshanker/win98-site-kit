// Three-digit seven-segment counter: formats a number as the three
// characters the display shows and swaps the digit images in place.

import { clamp } from "../../kit/index.js";

export const COUNTER_MAX = 999;

const DIGITS_PATH = "assets/solitaire/digits";

export const DIGIT_SOURCES = Object.freeze({
  0: `${DIGITS_PATH}/digital_0.png`,
  1: `${DIGITS_PATH}/digital_1.png`,
  2: `${DIGITS_PATH}/digital_2.png`,
  3: `${DIGITS_PATH}/digital_3.png`,
  4: `${DIGITS_PATH}/digital_4.png`,
  5: `${DIGITS_PATH}/digital_5.png`,
  6: `${DIGITS_PATH}/digital_6.png`,
  7: `${DIGITS_PATH}/digital_7.png`,
  8: `${DIGITS_PATH}/digital_8.png`,
  9: `${DIGITS_PATH}/digital_9.png`,
  "-": `${DIGITS_PATH}/digital_minus.png`,
  " ": `${DIGITS_PATH}/digital_blank.png`,
});

/** `-99..999` as three characters, zero-padded (`007`, `-05`). */
export const formatSevenSegmentCounter = (value) => {
  const clamped = clamp(value, -99, COUNTER_MAX);
  if (clamped < 0) return `-${String(Math.abs(clamped)).padStart(2, "0")}`;
  return String(clamped).padStart(3, "0");
};

/** Writes `value` onto the three `<img>` digits inside `element`. */
export const setSevenSegmentCounter = (element, value) => {
  if (!element) return;
  const digits = String(value).padStart(3, " ").slice(-3);
  element.querySelectorAll("img").forEach((image, index) => {
    const char = digits[index] ?? " ";
    const source = DIGIT_SOURCES[char] || DIGIT_SOURCES[" "];
    if (image.getAttribute("src") !== source) image.src = source;
    image.alt = char.trim() || " ";
  });
};
