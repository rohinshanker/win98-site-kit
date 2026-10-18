// Seven-segment counter helpers (mine and time displays) and the full-screen
// confetti effect. Leaf module: no kit or DOM access at import time, so the
// formatting half is node-testable.

export const COUNTER_MAX = 999;
export const COUNTER_MIN = -99;

const DIGIT_FILES = Object.freeze({
  0: "digital_0.png",
  1: "digital_1.png",
  2: "digital_2.png",
  3: "digital_3.png",
  4: "digital_4.png",
  5: "digital_5.png",
  6: "digital_6.png",
  7: "digital_7.png",
  8: "digital_8.png",
  9: "digital_9.png",
  "-": "digital_minus.png",
  " ": "digital_blank.png",
});

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/** Maps each counter character to its digit image under `assetBase`. */
export const digitSources = (assetBase) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(DIGIT_FILES).map(([character, file]) => [character, `${assetBase}/digital_digits/${file}`])
    )
  );

/** Three characters: `000`…`999`, or `-01`…`-99` for negatives. */
export const formatSevenSegmentCounter = (value) => {
  const clamped = clamp(Math.trunc(Number(value) || 0), COUNTER_MIN, COUNTER_MAX);
  if (clamped < 0) return `-${String(Math.abs(clamped)).padStart(2, "0")}`;
  return String(clamped).padStart(3, "0");
};

/** Writes a formatted counter string into the three `<img>` digits of `el`. */
export const setSevenSegmentCounter = (el, value, sources) => {
  if (!el) return;
  const digits = String(value).padStart(3, " ").slice(-3);
  el.querySelectorAll("img").forEach((img, index) => {
    const character = digits[index] ?? " ";
    img.src = sources[character] || sources[" "];
    img.alt = character.trim() || " ";
  });
};

/**
 * Confetti on a fixed, full-viewport canvas. `start()` drops `pieceCount`
 * squares and animates until the last one leaves the screen; `resize()`
 * follows the viewport; `stop()` cancels and clears.
 */
export const createConfetti = (canvas, { pieceCount = 120 } = {}) => {
  const context = canvas?.getContext ? canvas.getContext("2d") : null;
  let pieces = [];
  let frameId = null;

  const resize = () => {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  const stop = () => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
    pieces = [];
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const animate = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const piece of pieces) {
      piece.x += piece.drift;
      piece.y += piece.speed;
      piece.rotation += piece.rotationSpeed;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
      context.restore();
    }
    pieces = pieces.filter((piece) => piece.y < canvas.height + 30);
    if (pieces.length > 0) {
      frameId = requestAnimationFrame(animate);
    } else {
      stop();
    }
  };

  const start = () => {
    if (!context) return;
    resize();
    pieces = Array.from({ length: pieceCount }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      size: 4 + Math.random() * 6,
      speed: 1 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 1.5,
      rotation: Math.random() * Math.PI,
      rotationSpeed: (Math.random() - 0.5) * 0.2,
      color: `hsl(${Math.random() * 360}, 90%, 60%)`,
    }));
    if (frameId) cancelAnimationFrame(frameId);
    animate();
  };

  return Object.freeze({ start, resize, stop, isRunning: () => frameId !== null });
};
