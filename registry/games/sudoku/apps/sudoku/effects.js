// Victory effects: a confetti canvas, a fireworks layer and the achievement
// banner. Each is a fixed, body-level element created on first use so window
// transforms cannot clip it. Copied from the site's Minesweeper and Solitaire.

import { flashBanner } from "../../kit/index.js";

const CONFETTI_PIECE_COUNT = 120;
const FIREWORK_BURST_COUNT = 9;
const FIREWORK_BURST_INTERVAL_MS = 260;
const FIREWORK_DURATION_MS = 3600;
const FIREWORK_PARTICLES = 46;
const FIREWORK_COLORS = Object.freeze([
  "#ff004d",
  "#ffa300",
  "#fff024",
  "#00e756",
  "#29adff",
  "#83769c",
  "#ff77a8",
  "#ffffff",
]);

const createLayer = (tag, className) => {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute("aria-hidden", "true");
  document.body.append(element);
  return element;
};

let confettiCanvas = null;
let confettiContext = null;
let confettiPieces = [];
let confettiAnimationId = null;

const ensureConfetti = () => {
  if (!confettiCanvas) {
    confettiCanvas = createLayer("canvas", "sudoku-confetti");
    confettiContext = confettiCanvas.getContext("2d");
  }
  return confettiContext;
};

const resizeConfetti = () => {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
};

/** Drops confetti over the whole page until every piece has fallen. */
export const startConfetti = () => {
  const context = ensureConfetti();
  if (!context) return;
  resizeConfetti();
  confettiPieces = Array.from({ length: CONFETTI_PIECE_COUNT }, () => ({
    x: Math.random() * confettiCanvas.width,
    y: -20 - Math.random() * confettiCanvas.height * 0.3,
    size: 4 + Math.random() * 6,
    speed: 1 + Math.random() * 3,
    drift: (Math.random() - 0.5) * 1.5,
    rotation: Math.random() * Math.PI,
    rotationSpeed: (Math.random() - 0.5) * 0.2,
    color: `hsl(${Math.random() * 360}, 90%, 60%)`,
  }));
  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);

  const animate = () => {
    context.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (const piece of confettiPieces) {
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
    confettiPieces = confettiPieces.filter((piece) => piece.y < confettiCanvas.height + 30);
    if (confettiPieces.length > 0) {
      confettiAnimationId = requestAnimationFrame(animate);
      return;
    }
    confettiAnimationId = null;
    context.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  };
  animate();
};

let fireworksLayer = null;
let fireworkTimers = [];
let fireworkTimeout = null;

const createFireworkBurst = (x, y) => {
  for (let index = 0; index < FIREWORK_PARTICLES; index += 1) {
    const dot = document.createElement("span");
    const angle = (Math.PI * 2 * index) / FIREWORK_PARTICLES + Math.random() * 0.22;
    const distance = 60 + Math.random() * 155;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance + 38;
    dot.className = "sudoku-firework-dot";
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.setProperty("--sudoku-firework-dx", `${dx.toFixed(1)}px`);
    dot.style.setProperty("--sudoku-firework-dy", `${dy.toFixed(1)}px`);
    dot.style.setProperty("--sudoku-firework-color", FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]);
    fireworksLayer.append(dot);
  }
};

/** Fires nine bursts across the upper half of the page, then clears them. */
export const startFireworks = () => {
  if (!fireworksLayer) fireworksLayer = createLayer("div", "sudoku-fireworks");
  fireworkTimers.forEach((timer) => clearTimeout(timer));
  fireworkTimers = [];
  if (fireworkTimeout) clearTimeout(fireworkTimeout);

  fireworksLayer.replaceChildren();
  fireworksLayer.classList.add("is-showing");

  for (let index = 0; index < FIREWORK_BURST_COUNT; index += 1) {
    fireworkTimers.push(
      setTimeout(() => {
        const x = window.innerWidth * (0.18 + Math.random() * 0.64);
        const y = window.innerHeight * (0.16 + Math.random() * 0.42);
        createFireworkBurst(x, y);
      }, index * FIREWORK_BURST_INTERVAL_MS)
    );
  }

  fireworkTimeout = setTimeout(() => {
    fireworksLayer.classList.remove("is-showing");
    fireworksLayer.replaceChildren();
    fireworkTimers = [];
    fireworkTimeout = null;
  }, FIREWORK_DURATION_MS);
};

let achievementBanner = null;

/** Slides the achievement image in from the right for six seconds. */
export const showAchievement = (imageSrc) => {
  if (!achievementBanner) {
    achievementBanner = createLayer("div", "sudoku-achievement");
    const image = document.createElement("img");
    image.src = imageSrc;
    image.alt = "";
    achievementBanner.append(image);
  }
  flashBanner(achievementBanner);
};
