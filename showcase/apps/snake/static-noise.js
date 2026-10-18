// Analogue static for the Snake board: random green dots, horizontal grain
// lines, scanlines and a vignette drawn onto a canvas layered over the game.

import { clamp } from "../../kit/index.js";

// Dot and scanline counts tuned for a CRT-sized panel.
const STATIC_DOTS = 390;
const GRAIN_LINES = 58;

export const drawStatic = (ctx, width, height) => {
  ctx.save();
  for (let index = 0; index < STATIC_DOTS; index += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() < 0.72 ? 1 : 2;
    const alpha = 0.08 + Math.random() * 0.24;
    ctx.fillStyle = `rgba(112, 255, 135, ${alpha})`;
    ctx.fillRect(x, y, size, 1);
  }
  for (let index = 0; index < GRAIN_LINES; index += 1) {
    const y = Math.random() * height;
    const length = width * (0.1 + Math.random() * 0.46);
    const centerJitter = (Math.random() - 0.5) * width * 0.18;
    const x = clamp(width * 0.5 - length * 0.5 + centerJitter, 0, width - length);
    ctx.fillStyle = `rgba(185, 255, 196, ${0.045 + Math.random() * 0.09})`;
    ctx.fillRect(x, y, length, 1);
  }
  ctx.restore();
};

export const drawDisplayGrain = (ctx, width, height, random = Math.random) => {
  ctx.save();
  for (let y = 0; y < height; y += 3) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, y, width, 1);
  }
  for (let index = 0; index < 170; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const alpha = 0.012 + random() * 0.04;
    ctx.fillStyle = `rgba(220, 255, 220, ${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    height * 0.1,
    width * 0.5,
    height * 0.48,
    Math.max(width, height) * 0.68
  );
  vignette.addColorStop(0, "rgba(255, 255, 255, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

/** Sizes the canvas to its CSS box at device resolution and clears it. */
export const prepareNoiseCanvas = (canvas) => {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth || canvas.offsetWidth || 1));
  const height = Math.max(1, Math.round(canvas.clientHeight || canvas.offsetHeight || 1));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
};

export const clearNoiseCanvas = (canvas) => {
  prepareNoiseCanvas(canvas);
};

export const drawNoiseCanvas = (canvas) => {
  const prepared = prepareNoiseCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  drawStatic(ctx, width, height);
  drawDisplayGrain(ctx, width, height);
};
